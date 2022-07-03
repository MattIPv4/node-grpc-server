import { fileURLToPath } from 'url';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import protobuf from 'protobufjs';

/**
 * Loads a gRPC package definition from a proto file.
 *
 * @param {URL} protoPath Path to the proto file.
 * @return {Promise<import('@grpc/grpc-js').GrpcObject>}
 */
const loadProto = async protoPath => {
    const packageDefinition = await protoLoader.load(fileURLToPath(protoPath));
    return grpc.loadPackageDefinition(packageDefinition);
};

/**
 * Start a new gRPC server instance.
 *
 * @param {number} [port=3000] Port number to listen on.
 * @return {Promise<void>}
 */
const start = async (
    port = 3000,
) => {
    // Create the server
    const server = new grpc.Server();

    /**
     * Track registered services for reflection.
     *
     * @type {import('@grpc/grpc-js').ServiceDefinition[]}
     */
    const services = [];

    /**
     * Track registered file descriptors for reflection.
     *
     * @type {Buffer[][]}
     */
    const fileDescriptorProtos = [];

    /**
     * Register a service with the server, with reflection.
     *
     * @param {import('@grpc/grpc-js').ServiceDefinition} service Service definition to register.
     * @param {import('@grpc/grpc-js').UntypedServiceImplementation} implementation Implementation of the service.
     */
    const addReflectedService = (service, implementation) => {
        services.push(service);
        const protos = Object.values(service)[0].requestType?.fileDescriptorProtos;
        if (protos) fileDescriptorProtos.push(protos);
        server.addService(service, implementation);
    };

    // Load in the file descriptor proto
    const descriptorProto = await protobuf.load(fileURLToPath(new URL('./protos/descriptor.proto', import.meta.url)));

    // Load and register the server reflection service
    const reflectionPackage = await loadProto(new URL('./protos/reflection.proto', import.meta.url));
    server.addService(reflectionPackage.grpc.reflection.v1alpha.ServerReflection.service, {
        /**
         * Handle a server reflection request.
         *
         * @param {import('@grpc/grpc-js').ServerWritableStream<(
         *   { listServices: string } |
         *   { fileContainingSymbol: string } |
         *   { fileByFilename: string } |
         *   { fileContainingExtension: string } |
         *   { allExtensionNumbersOfType: string }
         * ), (
         *   { listServicesResponse: { service: { name: string }[] } } |
         *   { fileDescriptorResponse: { fileDescriptorProto: Buffer[] } } |
         *   { errorResponse: { errorCode: number } }
         * )>} call Incoming gRPC call.
         */
        ServerReflectionInfo: call => {
            console.log('Reflection request started');

            call.on('data', request => {
                console.log('Reflection request data', request);
                const { listServices, fileContainingSymbol, fileByFilename } = request;
                // TODO: Implement fileContainingExtension & allExtensionNumbersOfType

                if (listServices) {
                    call.write({
                        listServicesResponse: {
                            service: services.map(service => ({
                                // Extract the name of the service from the first method (/$service/$method)
                                name: Object.values(service)[0].path.split('/')[1],
                            })),
                        },
                    });
                    console.log('Sent listServicesResponse');
                    return;
                }

                if (fileContainingSymbol) {
                    // Consider each set of protos that might match
                    // eslint-disable-next-line no-restricted-syntax
                    for (const protos of fileDescriptorProtos) {
                        // Look for a match within this set of protos
                        // eslint-disable-next-line no-restricted-syntax
                        for (const proto of protos) {
                            const fdp = descriptorProto.lookupType('google.protobuf.FileDescriptorProto').decode(proto);
                            const packageName = fdp.package && `${fdp.package}.`;
                            const serviceMatch = fdp.service.findIndex(service => `${packageName}${service.name}` === fileContainingSymbol) !== -1;
                            const messageTypeMatch = fdp.messageType.findIndex(messageType => `${packageName}${messageType.name}` === fileContainingSymbol) !== -1;
                            const enumTypeMatch = fdp.enumType.findIndex(enumType => `${packageName}${enumType.name}` === fileContainingSymbol) !== -1;

                            // If we have a match, return this set of protos
                            if (fdp.package === fileContainingSymbol || serviceMatch || messageTypeMatch || enumTypeMatch) {
                                call.write({
                                    fileDescriptorResponse: {
                                        fileDescriptorProto: protos,
                                    },
                                });
                                console.log('Sent fileDescriptorResponse for', fdp.name);
                                return;
                            }
                        }
                    }

                    call.write({
                        errorResponse: {
                            errorCode: grpc.status.NOT_FOUND,
                        },
                    });
                    console.log('Sent NOT_FOUND');
                    return;
                }

                if (fileByFilename) {
                    // Consider each set of protos that might match
                    // eslint-disable-next-line no-restricted-syntax
                    for (const protos of fileDescriptorProtos) {
                        // Look for a match within this set of protos
                        // eslint-disable-next-line no-restricted-syntax
                        for (const proto of protos) {
                            const fdp = descriptorProto.lookupType('google.protobuf.FileDescriptorProto').decode(proto);

                            // If we have a match, return this set of protos
                            if (fdp.name === fileByFilename) {
                                call.write({
                                    fileDescriptorResponse: {
                                        fileDescriptorProto: protos,
                                    },
                                });
                                console.log('Sent fileDescriptorResponse for', fdp.name);
                                return;
                            }
                        }
                    }

                    call.write({
                        errorResponse: {
                            errorCode: grpc.status.NOT_FOUND,
                        },
                    });
                    console.log('Sent NOT_FOUND');
                    return;
                }

                call.write({
                    errorResponse: {
                        errorCode: grpc.status.UNIMPLEMENTED,
                    },
                });
                console.log('Sent UNIMPLEMENTED');
            });

            call.on('end', () => {
                call.end();
                console.log('Reflection request ended');
            });

            call.on('cancelled', () => {
                console.log('Reflection request cancelled');
            });
        },
    });

    // Load the greeter definition
    const { greeter } = await loadProto(new URL('./protos/greeter.proto', import.meta.url));
    addReflectedService(greeter.Greeter.service, {
        /**
         * Respond to the sayHello request.
         *
         * @param {import('@grpc/grpc-js').ServerUnaryCall<{ name: string }, { message: string }>} call Incoming gRPC call.
         * @param {import('@grpc/grpc-js').sendUnaryData<{ message: string }>} callback Callback to send the response.
         */
        sayHello: (call, callback) => {
            callback(null, { message: `Hello, ${call.request.name}` });
        },
    });

    // Start the server
    const bind = `0.0.0.0:${port}`;
    await new Promise((resolve, reject) => server.bindAsync(
        bind,
        grpc.ServerCredentials.createInsecure(),
        (err, res) => (err
            ? reject(err)
            : resolve(res)),
    ));
    server.start();

    // Log that we've started
    console.log(`Listening at ${bind}`);
};

start().catch(err => {
    console.error(err);
    process.exit(1);
});

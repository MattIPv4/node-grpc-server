# Node gRPC Server

Demo gRPC server in Node.js with a partial server reflection implementation and a demo greeter service.

1. Install Node.js matching `.nvmrc`.
2. Install dependencies with `npm ci`.
3. Start the server with `npm start`.

- View the reflected services with the grpcurl CLI: `grpcurl -plaintext localhost:3000 list`
- View the methods for a service with the grpcurl CLI: `grpcurl -plaintext localhost:3000 list greeter.Greeter`
- Make a call to the greeter service with the grpcurl CLI: `grpcurl -plaintext -d '{"name":"test"}' localhost:3000 greeter.Greeter.SayHello`

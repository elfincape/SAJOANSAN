import { makeDiagnosticHandler } from './handler.js';

Deno.serve(
  makeDiagnosticHandler(Deno.env.toObject(), {
    resolveDns: (hostname: string, type: 'A') =>
      Deno.resolveDns(hostname, type),
    connect: (options: Deno.ConnectOptions) => Deno.connect(options),
    startTls: (connection: Deno.Conn, options: Deno.StartTlsOptions) =>
      Deno.startTls(connection, options),
  }),
);

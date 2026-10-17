import { makeDiagnosticHandler } from './handler.js';

Deno.serve(
  makeDiagnosticHandler(
    Deno.env.toObject(),
    {
      resolveDns: (hostname: string, type: 'A') =>
        Deno.resolveDns(hostname, type),
      connect: (options: Deno.ConnectOptions) => Deno.connect(options),
      startTls: (connection: Deno.Conn, options: Deno.StartTlsOptions) =>
        Deno.startTls(connection, options),
    },
    {
      delegate: async ({
        token,
        holder,
      }: {
        token: string;
        holder: string;
      }) => {
        const response = await fetch(
          'https://sajoansan.vercel.app/api/private-mail-diagnostic',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ lease: holder }),
            signal: AbortSignal.timeout(25000),
            redirect: 'error',
          },
        );
        if (!response.ok) throw Error('NODE_PROBE_UNAVAILABLE');
        return response.json();
      },
    },
  ),
);

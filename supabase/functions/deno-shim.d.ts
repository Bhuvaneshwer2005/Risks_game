// Minimal Deno globals so tsc can type-check the Edge Function (see tsconfig.json).
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
  const env: { get(name: string): string | undefined };
}

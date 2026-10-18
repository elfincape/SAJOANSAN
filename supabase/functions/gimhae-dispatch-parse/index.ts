import { makeHandler } from './handler.js';
Deno.serve(makeHandler(Deno.env.toObject()));

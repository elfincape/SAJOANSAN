import {makeRelationsHandler} from './handler.js';
Deno.serve(makeRelationsHandler(Deno.env.toObject()));

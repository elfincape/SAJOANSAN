import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { makeHandler } from './handler.js';
import { makePdfBuilder } from './pdf.js';
Deno.serve(makeHandler(Deno.env.toObject(),fetch,makePdfBuilder(PDFDocument)));

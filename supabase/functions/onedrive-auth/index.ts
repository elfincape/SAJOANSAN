import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { makeHandler } from './handler.js';
import { makePdfBuilder } from './pdf.js';
import ExcelJS from 'npm:exceljs@4.4.0';
import {makeBackupWorkbook} from './backup-workbook.js';
Deno.serve(makeHandler(Deno.env.toObject(),fetch,makePdfBuilder(PDFDocument),makeBackupWorkbook(ExcelJS)));

import { statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import ExcelJS from 'exceljs'
import { IMPORT_MAX_ROWS, valueToText } from '../../shared/partyImport/partyImport'
import { AppError } from '../ipc/envelope'

/** One worksheet as plain text, rows[0] = sheet row 1. Trailing empty rows are dropped. */
export interface SheetData { fileName: string; sheets: string[]; sheet: string; rows: string[][] }

/** Port so the service can be tested without a file (and so ExcelJS stays in this one file). */
export interface SheetReader { read(filePath: string, sheet?: string): Promise<SheetData> }

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024
const EXTENSIONS = ['.xlsx', '.xlsm', '.csv']

export function createExcelSheetReader(): SheetReader {
  return {
    async read(filePath, sheet) {
      const ext = extname(filePath).toLowerCase()
      if (ext === '.xls') throw new AppError('VALIDATION', 'Old .xls files are not supported. Open it in Excel and use Save As .xlsx (or .csv).')
      if (!EXTENSIONS.includes(ext)) throw new AppError('VALIDATION', 'Choose an Excel (.xlsx) or .csv file')
      let size: number
      try { size = statSync(filePath).size } catch { throw new AppError('IO_ERROR', 'That file could not be opened') }
      if (size > IMPORT_MAX_BYTES) throw new AppError('VALIDATION', 'That file is larger than 10 MB')
      const wb = new ExcelJS.Workbook()
      try {
        if (ext === '.csv') await wb.csv.readFile(filePath)
        else await wb.xlsx.readFile(filePath)
      } catch {
        throw new AppError('VALIDATION', 'That file could not be read as a spreadsheet')
      }
      const sheets = wb.worksheets.map((w) => w.name)
      if (sheets.length === 0) throw new AppError('VALIDATION', 'The file has no sheets')
      const name = sheet && sheets.includes(sheet) ? sheet : sheets[0]!
      const ws = wb.getWorksheet(name)!
      if (ws.rowCount > IMPORT_MAX_ROWS + 50) throw new AppError('VALIDATION', `The sheet has more than ${IMPORT_MAX_ROWS} rows`)
      const rows: string[][] = []
      const width = ws.columnCount
      for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)
        const cells: string[] = []
        for (let c = 1; c <= width; c++) cells.push(valueToText(row.getCell(c).value))
        rows.push(cells)
      }
      while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim() === '')) rows.pop()
      return { fileName: basename(filePath), sheets, sheet: name, rows }
    }
  }
}

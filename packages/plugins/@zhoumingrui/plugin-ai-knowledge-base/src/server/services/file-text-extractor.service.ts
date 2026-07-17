/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import pdf from 'pdf-parse';
import * as XLSX from 'xlsx';

export class FileTextExtractorService {
  async extract(input: { filename: string; mimeType?: string; content: Buffer }): Promise<string> {
    const extension = input.filename.split('.').pop()?.toLowerCase();
    if (extension === 'txt' || extension === 'md' || extension === 'csv') return input.content.toString('utf8');
    if (extension === 'pdf') return (await pdf(input.content)).text;
    if (extension === 'docx') return (await mammoth.extractRawText({ buffer: input.content })).value;
    if (extension === 'xlsx' || extension === 'xls') {
      const workbook = XLSX.read(input.content, { type: 'buffer' });
      return workbook.SheetNames.map((name) => `# ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join(
        '\n\n',
      );
    }
    if (extension === 'pptx') return this.extractPptx(input.content);
    throw new Error(`Unsupported file type: ${extension ?? 'unknown'}.`);
  }

  private async extractPptx(content: Buffer) {
    const archive = await JSZip.loadAsync(content);
    const slides = Object.keys(archive.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const text = await Promise.all(
      slides.map(
        async (name) =>
          (await archive.file(name)?.async('text'))
            ?.match(/<a:t>(.*?)<\/a:t>/g)
            ?.map((value) => value.replace(/<\/?a:t>/g, ''))
            .join(' ') ?? '',
      ),
    );
    return text.filter(Boolean).join('\n\n');
  }
}

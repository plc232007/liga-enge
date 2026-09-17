// PDF básico multipágina: texto normalizado para Helvetica, sem conteúdo executável.
export function pdf(rows: string[][]): Buffer {
    const lines = rows.flatMap((row, i) => { const text = (i === 0 ? 'LIGA ENGESOFTWARE — ' : '') + row.join(' | '); return text.match(/.{1,100}/g) ?? ['']; });
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += 45)
        pages.push(lines.slice(i, i + 45));
    const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const pageIds: number[] = [];
    for (const page of pages) {
        const pageId = objects.length + 1, streamId = pageId + 1;
        pageIds.push(pageId);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
        const escape = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ').replace(/([\\()])/g, '\\$1');
        const stream = 'BT /F1 9 Tf 35 560 Td 11 TL ' + page.map(s => `(${escape(s)}) Tj T*`).join('\n') + ' ET';
        objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    }
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let content = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(content));
        content += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const start = Buffer.byteLength(content);
    content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
    return Buffer.from(content);
}

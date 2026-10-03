/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { deflateSync } from 'node:zlib';

/**
 * A PDF with `pageCount` blank pages: a catalog, one page tree node and the
 * pages. With `objectStream`, those objects are packed into a compressed object
 * stream, as most current writers do.
 */
export function buildPdf(
    pageCount: number,
    { objectStream = false }: { objectStream?: boolean } = {},
): Buffer {
    const kids = Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`,
        ...kids.map(
            () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
        ),
    ];
    const trailer = 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';

    if (!objectStream) {
        const body = objects
            .map((object, i) => `${i + 1} 0 obj\n${object}\nendobj\n`)
            .join('');
        return Buffer.from(`%PDF-1.4\n${body}${trailer}`, 'latin1');
    }

    let offset = 0;
    const header: string[] = [];
    for (const [i, object] of objects.entries()) {
        header.push(`${i + 1} ${offset}`);
        offset += object.length + 1;
    }
    const headerText = `${header.join(' ')}\n`;
    const data = deflateSync(
        Buffer.from(headerText + objects.join('\n'), 'latin1'),
    );
    const streamId = objects.length + 1;
    return Buffer.concat([
        Buffer.from(
            `%PDF-1.7\n${streamId} 0 obj\n<< /Type /ObjStm /N ${objects.length} /First ${headerText.length} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
            'latin1',
        ),
        data,
        Buffer.from(`\nendstream\nendobj\n${trailer}`, 'latin1'),
    ]);
}

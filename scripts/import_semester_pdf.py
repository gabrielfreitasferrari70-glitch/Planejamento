"""Extract this UC2 weekly-grid PDF without changing the source document.

Requires PyMuPDF. Inspect extraction results whenever the PDF layout changes.
"""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil

import fitz


def normalize(text):
    return re.sub(r'\s+', ' ', text).strip()


def boundaries(page):
    segments = []
    for drawing in page.get_drawings():
        if not drawing['fill'] or max(drawing['fill']) > .05:
            continue
        for item in drawing['items']:
            if item[0] == 're':
                rect = item[1]
                if rect.width > 50 and rect.height < 4:
                    segments.append(((rect.y0 + rect.y1) / 2, rect.width))
            elif item[0] == 'l':
                start, end = item[1:]
                if abs(start.y - end.y) < .3 and abs(start.x - end.x) > 50:
                    segments.append((start.y, abs(start.x - end.x)))
    groups = []
    for y, length in sorted(segments):
        if not groups or y - groups[-1][-1][0] > 2.5:
            groups.append([])
        groups[-1].append((y, length))
    return [sum(y * length for y, length in group) / sum(length for _, length in group)
            for group in groups if sum(length for _, length in group) > 350]


def cell_text(words, rect):
    lines = []
    selected = sorted((word for word in words
                       if rect.contains(fitz.Point((word[0]+word[2])/2, (word[1]+word[3])/2))),
                      key=lambda word: ((word[1]+word[3])/2, word[0]))
    for word in selected:
        center = (word[1]+word[3])/2
        if not lines or abs(center - lines[-1][0]) > 2:
            lines.append((center, []))
        lines[-1][1].append(word)
    return '\n'.join(' '.join(word[4] for word in sorted(line, key=lambda word: word[0]))
                     for _, line in lines)


def cell_color(pixmap, rect):
    # Compound PDF paths may enclose unfilled areas. Sample rendered backgrounds
    # rather than treating each path's enclosing rectangle as a filled cell.
    samples = []
    for y in [rect.y0+5, (rect.y0+rect.y1)/2, rect.y1-5]:
        for offset in [4, 5, 6]:
            samples.append(pixmap.pixel(round((rect.x0+offset)*2), round(y*2))[:3])
    color = Counter(samples).most_common(1)[0][0]
    return '#' + ''.join(f'{channel:02X}' for channel in color)


def event_kind(title):
    if re.search(r'prova|avaliaç|exame|teste|seminários?\s+[12]º\s*módulo|2[ªa]\s*chamada', title, re.I):
        return 'exam'
    if re.search(r'feriado|recesso|dia do servidor público', title, re.I):
        return 'break'
    if re.fullmatch(r'(?:livre(?: para estudo)?|horário livre)', title, re.I):
        return 'free'
    if re.search(r'tutoria', title, re.I):
        return 'tutorial'
    if re.search(r'interação comunitária', title, re.I):
        return 'community'
    if re.search(r'acolhimento', title, re.I):
        return 'welcome'
    return 'class'


def subject(title):
    if ':' in title:
        return title.split(':', 1)[0].strip()
    for label in ['Anatomia', 'Antropologia', 'Interação Comunitária']:
        if re.search(re.escape(label), title, re.I):
            return label
    return 'UC2'


def extract(source):
    document = fitz.open(source)
    records, audit, dates = [], [], set()
    for page_number, page in enumerate(document, 1):
        words = page.get_text('words')
        date_words = sorted([w for w in words if re.fullmatch(r'\d{2}/\d{2}/20\d{2}', w[4])],
                            key=lambda w: ((w[1]+w[3])/2, w[0]))
        # The header's font baselines vary slightly: group by proximity.
        headers = []
        for word in date_words:
            center = (word[1]+word[3])/2
            if not headers or abs(center - headers[-1][0]) > 3:
                headers.append((center, []))
            headers[-1][1].append(word)
        assert len(headers) == 2, (page_number, 'Expected morning and afternoon headers')
        times = sorted([w for w in words if re.fullmatch(r'\d{1,2}:\d{2}-\d{1,2}:\d{2}', w[4])],
                       key=lambda w: w[1])
        assert len(times) == 4, (page_number, 'Expected four teaching slots')
        edges = boundaries(page)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        for index, time_word in enumerate(times):
            _, columns = headers[index // 2]
            columns = sorted(columns, key=lambda w: w[0])
            assert len(columns) == 6, (page_number, 'Expected Monday through Saturday')
            centers = [(w[0]+w[2])/2 for w in columns]
            width = (centers[-1]-centers[0])/5
            y = (time_word[1]+time_word[3])/2
            top = max(edge for edge in edges if edge < y)
            bottom = min(edge for edge in edges if edge > y)
            assert 60 < bottom-top < 95, (page_number, time_word[4], top, bottom)
            start, end = [datetime.strptime(t, '%H:%M').strftime('%H:%M') for t in time_word[4].split('-')]
            for column, header in enumerate(columns):
                date = datetime.strptime(header[4], '%d/%m/%Y').date().isoformat()
                dates.add(date)
                rect = fitz.Rect(centers[column]-width/2+1, top+1,
                                 centers[column]+width/2-1, bottom-1)
                text = cell_text(words, rect)
                if not text:
                    continue
                match = re.search(r'\b(?:Prof(?:essor(?:a)?|[saª])?\.?|Docente)\s+', text, re.I)
                professor = normalize(text[match.start():]) if match else ''
                title = normalize(text[:match.start()] if match else text).rstrip(' -–—')
                if not match and event_kind(title) == 'exam':
                    lines = text.splitlines()
                    if re.fullmatch(r'(?:Flávio|Denício|Clarissa)(?: e (?:Flávio|Denício|Clarissa))?', lines[-1]):
                        professor = lines[-1]
                        title = normalize(' '.join(lines[:-1])).rstrip(' -–—')
                assert title, (page_number, date, start, text)
                record = {'date': date, 'from': start, 'to': end, 'title': title,
                          'subject': subject(title),
                          'type': event_kind(title), 'origin': 'pdf', 'professor': professor,
                          'sheetColor': cell_color(pixmap, rect), 'sourcePages': [page_number]}
                records.append(record)
                audit.append({'page': page_number, 'date': date, 'from': start, 'raw': text})
    # Page 19 repeats page 18. Retain provenance without duplicating events.
    unique = {}
    for item in records:
        key = tuple(item.get(k) for k in ['date','from','to','title','professor','sheetColor'])
        if key in unique:
            unique[key]['sourcePages'] += item['sourcePages']
        else:
            unique[key] = dict(item)
    merged = []
    for item in sorted(unique.values(), key=lambda x: (x['date'], x['from'])):
        previous = merged[-1] if merged else None
        if previous and previous['date'] == item['date'] and previous['to'] == item['from'] and all(
                previous[k] == item[k] for k in ['title','subject','type','professor','sheetColor']):
            previous['to'] = item['to']
            previous['sourcePages'] = sorted(set(previous['sourcePages'] + item['sourcePages']))
        else:
            merged.append(dict(item))
    for item in merged:
        identity = '|'.join(item[k] for k in ['date','from','to','title'])
        item['id'] = 'uc2-2026-2-' + hashlib.sha256(identity.encode()).hexdigest()[:16]
    metadata = {'semester': '2026/2', 'filename': source.name,
                'sourceUrl': './data/uc2-2026-2.pdf', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'pages': len(document), 'weeks': len(dates)//6,
                'start': min(dates), 'end': max(dates), 'events': len(merged),
                'rawCells': len(records), 'uniqueCells': len(unique),
                'counts': dict(Counter(x['type'] for x in merged)),
                'legend': [{'color': Counter(x['sheetColor'] for x in merged if x['type']==kind).most_common(1)[0][0],
                            'name': label} for kind, label in [
                                ('tutorial','Tutorias'),('class','Aulas'),('exam','Avaliações'),
                                ('break','Feriados'),('community','Interação Comunitária'),
                                ('free','Horário livre'),('welcome','Acolhimento')]],
                'note': 'Página 19 repete a página 18. Blocos consecutivos idênticos foram unidos.'}
    return merged, metadata, audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output', type=Path, default=Path('.'))
    args = parser.parse_args()
    events, metadata, audit = extract(args.pdf)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'data').mkdir(exist_ok=True)
    for filename, data in [('academic.json', events), ('academic-source.json', metadata)]:
        (args.output/filename).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    shutil.copyfile(args.pdf, args.output/'data/uc2-2026-2.pdf')
    Path('/tmp/uc2-extraction-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    print(json.dumps(metadata,ensure_ascii=False,indent=2))

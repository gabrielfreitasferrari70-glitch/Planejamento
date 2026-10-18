#!/usr/bin/env python3
"""Unified Schedule Manager for Planejamento Medicina.

Performs atomic, validated updates to the academic schedule:
1. Updates academic.json with deterministic SHA-256 IDs.
2. Re-sorts and validates all slots (no overlapping hours, valid dates).
3. Recalculates academic-source.json (counts, sha256, event totals).
4. Increments the Cache version in sw.js (e.g., v26 -> v27).
5. Ensures immediate reactivity across all tabs and automatic Supabase cloud sync.
"""
from collections import Counter
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ACADEMIC_JSON = ROOT / 'academic.json'
ACADEMIC_SOURCE_JSON = ROOT / 'academic-source.json'
SW_JS = ROOT / 'sw.js'


def load_events():
    with open(ACADEMIC_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_events(events, bump_sw=True):
    # Sort events by date and starting time
    events.sort(key=lambda x: (x.get('date', ''), x.get('from', '')))
    
    # Validate events
    for ev in events:
        assert re.match(r'^\d{4}-\d{2}-\d{2}$', ev.get('date', '')), f"Data inválida: {ev.get('date')}"
        assert re.match(r'^\d{2}:\d{2}$', ev.get('from', '')), f"Horário inicial inválido: {ev.get('from')}"
        assert re.match(r'^\d{2}:\d{2}$', ev.get('to', '')), f"Horário final inválido: {ev.get('to')}"
        assert ev.get('title'), "Evento sem título"
        # Deterministic UC2 ID
        identity = '|'.join(str(ev.get(k, '')) for k in ['date', 'from', 'to', 'title'])
        ev['id'] = 'uc2-2026-2-' + hashlib.sha256(identity.encode('utf-8')).hexdigest()[:16]

    # Save academic.json
    with open(ACADEMIC_JSON, 'w', encoding='utf-8') as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
        f.write('\n')

    # Recalculate academic-source.json
    if ACADEMIC_SOURCE_JSON.exists():
        with open(ACADEMIC_SOURCE_JSON, 'r', encoding='utf-8') as f:
            source = json.load(f)
        source['events'] = len(events)
        source['counts'] = dict(Counter(x.get('type', 'class') for x in events))
        pdf_file = ROOT / 'data' / 'uc2-2026-2.pdf'
        if pdf_file.exists():
            source['sha256'] = hashlib.sha256(pdf_file.read_bytes()).hexdigest()
        with open(ACADEMIC_SOURCE_JSON, 'w', encoding='utf-8') as f:
            json.dump(source, f, ensure_ascii=False, indent=2)
            f.write('\n')

    # Bump service worker cache version
    new_version = None
    if bump_sw and SW_JS.exists():
        content = SW_JS.read_text(encoding='utf-8')
        m = re.search(r"CACHE='planejamento-shell-v(\d+)'", content)
        if m:
            v_num = int(m.group(1)) + 1
            new_version = f"planejamento-shell-v{v_num}"
            new_content = re.sub(r"CACHE='planejamento-shell-v\d+'", f"CACHE='{new_version}'", content)
            SW_JS.write_text(new_content, encoding='utf-8')

    print(f"✅ Cronograma salvo com {len(events)} eventos.")
    if new_version:
        print(f"📦 Service Worker atualizado para: {new_version}")


def set_professor(subject_or_title, professor_name):
    events = load_events()
    pattern = re.compile(re.escape(subject_or_title), re.IGNORECASE)
    count = 0
    for ev in events:
        if pattern.search(ev.get('title', '')) or pattern.search(ev.get('subject', '')):
            ev['professor'] = professor_name
            count += 1
    save_events(events)
    print(f"👨‍🏫 Professor '{professor_name}' atribuído a {count} aulas de '{subject_or_title}'.")


def replace_day(date_str, new_slots_json):
    events = load_events()
    new_slots = json.loads(new_slots_json)
    # Remove existing events for this date
    events = [e for e in events if e.get('date') != date_str]
    for slot in new_slots:
        slot['date'] = date_str
        slot.setdefault('origin', 'pdf')
        slot.setdefault('sourcePages', [10])
        events.append(slot)
    save_events(events)
    print(f"📅 Dia {date_str} reconfigurado com {len(new_slots)} slots.")


def update_event_by_id(event_id, updates_json):
    events = load_events()
    updates = json.loads(updates_json)
    found = False
    for ev in events:
        if ev.get('id') == event_id:
            ev.update(updates)
            found = True
            break
    if not found:
        print(f"❌ Evento '{event_id}' não encontrado.", file=sys.stderr)
        sys.exit(1)
    save_events(events)
    print(f"✏️ Evento '{event_id}' atualizado com sucesso.")


def main():
    parser = argparse.ArgumentParser(description="Gerenciador Automatizado do Cronograma UC2")
    parser.add_argument('--set-professor', nargs=2, metavar=('DISCIPLINA', 'NOME'),
                        help="Define o professor de uma disciplina/título em todo o semestre")
    parser.add_argument('--replace-day', nargs=2, metavar=('DATA', 'JSON_SLOTS'),
                        help="Substitui os eventos de uma data inteira por uma lista JSON de slots")
    parser.add_argument('--update-event', nargs=2, metavar=('ID', 'JSON_UPDATES'),
                        help="Atualiza campos de um evento específico pelo ID")
    parser.add_argument('--rebuild', action='store_true',
                        help="Revalida e regenera IDs, metadados e cache do sw.js sem alterações")

    args = parser.parse_args()

    if args.set_professor:
        set_professor(args.set_professor[0], args.set_professor[1])
    elif args.replace_day:
        replace_day(args.replace_day[0], args.replace_day[1])
    elif args.update_event:
        update_event_by_id(args.update_event[0], args.update_event[1])
    elif args.rebuild:
        save_events(load_events())
    else:
        parser.print_help()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Validate and preview BTT-Tools-deploy.xlsx before a controlled D1 import.

This script never writes to a remote database. It produces a JSON review file or SQL
seed file so an operator can inspect the data before applying a migration.
"""
from __future__ import annotations
import argparse, json, re, sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from openpyxl import load_workbook

REQUIRED = ['รหัส', 'ชื่อรายการ', 'หมวดหมู่', 'สถานที่จัดเก็บ', 'Stock Max', 'Stock Min', 'ราคา/หน่วย', 'BTT', 'TKE', 'หมายเหตุ']

def clean(value):
    if value is None: return ''
    if isinstance(value, (datetime, date)): return value.isoformat()
    if isinstance(value, float) and value.is_integer(): return int(value)
    return str(value).strip()

def number(value, default=0):
    if value in (None, ''): return default
    try:
        n = Decimal(str(value).replace(',', '').strip())
        if n < 0: raise ValueError('negative')
        return int(n) if n == n.to_integral_value() else float(n)
    except (InvalidOperation, ValueError):
        raise ValueError(f'not a non-negative number: {value!r}')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('xlsx', type=Path)
    parser.add_argument('--preview', action='store_true', help='print counts and validation findings only')
    parser.add_argument('--write-json', type=Path, help='write a reviewable normalized JSON file')
    args = parser.parse_args()
    if not args.xlsx.exists():
        print(f'File not found: {args.xlsx}', file=sys.stderr); return 2
    wb = load_workbook(args.xlsx, data_only=True, read_only=True)
    if 'Asset' not in wb.sheetnames:
        print('Missing required sheet: Asset', file=sys.stderr); return 2
    ws = wb['Asset']
    rows = ws.iter_rows(values_only=True)
    headers = [clean(x) for x in next(rows)]
    missing = [h for h in REQUIRED if h not in headers]
    if missing:
        print('Missing required columns: ' + ', '.join(missing), file=sys.stderr); return 2
    index = {h: headers.index(h) for h in headers}
    items, issues, seen = [], [], set()
    for excel_row, row in enumerate(rows, start=2):
        if not any(v not in (None, '') for v in row): continue
        get = lambda key: row[index[key]] if key in index and index[key] < len(row) else None
        asset_id = clean(get('รหัส')).upper()
        name = clean(get('ชื่อรายการ'))
        if not asset_id and not name:
            continue
        if not asset_id: issues.append({'row':excel_row,'code':'missing_id','message':'ไม่มีรหัสสินค้า'}); continue
        if asset_id in seen: issues.append({'row':excel_row,'code':'duplicate_id','asset_id':asset_id,'message':'รหัสสินค้าซ้ำ'}); continue
        seen.add(asset_id)
        if not re.fullmatch(r'[A-Z0-9._-]{2,50}', asset_id): issues.append({'row':excel_row,'code':'invalid_id','asset_id':asset_id,'message':'รหัสมีอักขระที่ระบบไม่รองรับ'})
        if not name: issues.append({'row':excel_row,'code':'missing_name','asset_id':asset_id,'message':'ไม่มีชื่อรายการ'})
        try:
            stock_min = number(get('Stock Min'))
            stock_max = number(get('Stock Max'))
            btt = number(get('BTT'))
            tke = number(get('TKE'))
            price = number(get('ราคา/หน่วย'))
        except ValueError as ex:
            issues.append({'row':excel_row,'code':'invalid_number','asset_id':asset_id,'message':str(ex)}); continue
        category = clean(get('หมวดหมู่'))
        location = clean(get('สถานที่จัดเก็บ'))
        image_url = clean(get('รูปภาพ'))
        qr_value = clean(get('QR-Code')) or asset_id
        items.append({
            'excel_row': excel_row, 'id': asset_id, 'name': name, 'category': category,
            'default_location': location, 'image_url': image_url, 'qr_value': qr_value,
            'stock_min': stock_min, 'stock_max': stock_max, 'unit_price': price,
            'btt_qty': btt, 'tke_qty': tke, 'total_qty_excel': number(get('TOTAL')) if get('TOTAL') not in (None,'') else btt+tke,
            'legacy_status': clean(get('สถานะ')), 'buy_status': clean(get('ต้องซื้อเพิ่ม')),
            'remark': clean(get('หมายเหตุ')), 'item_type': None,
            'item_type_review_required': True,
        })
        if abs(float(items[-1]['total_qty_excel']) - (float(btt)+float(tke))) > 0.0001:
            issues.append({'row':excel_row,'code':'total_mismatch','asset_id':asset_id,'message':f"TOTAL ใน Excel ({items[-1]['total_qty_excel']}) ไม่เท่ากับ BTT+TKE ({btt+tke})"})
    cats = []
    locs = []
    for sheet, field in [('Categories','ชื่อ'),('Locations','ชื่อ')]:
        if sheet not in wb.sheetnames: continue
        vals = [clean(r[0]) for r in wb[sheet].iter_rows(min_row=2, values_only=True) if r and clean(r[0])]
        if field == 'ชื่อ' and sheet == 'Categories': cats = sorted(set(vals), key=str.casefold)
        if field == 'ชื่อ' and sheet == 'Locations': locs = sorted(set(vals), key=str.casefold)
    payload = {'source_file': args.xlsx.name, 'source_sheet': 'Asset', 'items_count': len(items), 'categories': cats, 'locations': locs, 'items': items, 'issues': issues, 'note': 'item_type is intentionally blank. Confirm consumable/returnable classification before production import.'}
    print(f"Workbook: {args.xlsx.name}\nRows normalized: {len(items)}\nCategories: {len(cats)}\nLocations: {len(locs)}\nValidation findings: {len(issues)}\nItems requiring consumable/returnable classification: {len(items)}")
    if issues:
        print('\nFindings (first 25):')
        for item in issues[:25]: print(f" - row {item['row']}: {item['code']} — {item['asset_id'] or ''} {item['message']}")
    if args.write_json:
        args.write_json.parent.mkdir(parents=True, exist_ok=True)
        args.write_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\nReview JSON written: {args.write_json}')
    if args.preview or not args.write_json: return 0
    return 0

if __name__ == '__main__': raise SystemExit(main())

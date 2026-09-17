from pathlib import Path
import json
from bs4 import BeautifulSoup

source = Path('/home/ubuntu/github-onboarding/public/resources/whs/EC-Office-Risk-Assessment.html')
soup = BeautifulSoup(source.read_text(encoding='utf-8'), 'html.parser')
categories = []
for index in range(13):
    anchor = soup.find(id=f'cat{index}')
    if not anchor:
        raise SystemExit(f'Missing category cat{index}')
    block = anchor.find(class_='catblock') or anchor
    title_node = block.find(class_='cattitle')
    title = title_node.get_text(' ', strip=True) if title_node else f'Category {index + 1}'
    rows = []
    for row in block.select('tbody tr'):
        cells = row.find_all('td')
        if len(cells) < 2:
            continue
        number = cells[0].get_text(' ', strip=True)
        label = cells[1].get_text(' ', strip=True)
        if number and label:
            rows.append({'id': f'{chr(65 + index)}{number}', 'label': label})
    if not rows:
        raise SystemExit(f'No rows for {title}')
    categories.append({'id': chr(65 + index), 'title': title.title(), 'items': rows})

count = sum(len(category['items']) for category in categories)
if count != 93:
    raise SystemExit(f'Expected 93 checklist items, found {count}')

module = '''/**\n * EC-WHS-ORA-001 Rev 2 canonical Office Risk Assessment checklist.\n * Extracted from the controlled reference template. IDs remain stable for\n * auditability; wording is presented in plain language by the staff form.\n */\nexport const OFFICE_RISK_CHECKLIST = ''' + json.dumps(categories, ensure_ascii=False, indent=2) + ''';\n\nexport const OFFICE_RISK_ITEM_IDS = OFFICE_RISK_CHECKLIST.flatMap((category) =>\n  category.items.map((item) => item.id),\n);\n'''
Path('/home/ubuntu/github-onboarding/lib/officeRiskChecklist.js').write_text(module, encoding='utf-8')
print(f'Generated {len(categories)} categories and {count} checklist items.')

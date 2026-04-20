import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Replace the card container: <div class="card" style="display:flex; gap:1.25rem; ..."> (and variations)
# Wait, let's just replace `class="card"` with `class="pod"` and strip the specific inline flex style we added.
# `class="card" style="display:flex; gap:1.25rem; ..."` -> `class="pod" style="..."`
def clean_card(m):
    card_attr = m.group(1)
    # Remove 'display:flex; gap:1.25rem;'
    cleaned = card_attr.replace('display:flex; gap:1.25rem;', '')
    # Remove 'display: flex; gap: 1.25rem;' 
    cleaned = cleaned.replace('display: flex; gap: 1.25rem; ', '')
    cleaned = cleaned.replace('display:flex; gap:1.2rem;', '')
    # Remove empty style tags or trailing spaces
    cleaned = cleaned.replace('style=""', '')
    return f'<div class="pod"{cleaned}>'

text = re.sub(r'<div class="card"([^>]*)>', clean_card, text)


# 2. Replace the icon wrapper: <div style="display: flex; align-items: flex-start; padding-top: 0.15rem;">
text = text.replace(
    '<div style="display: flex; align-items: flex-start; padding-top: 0.15rem;">',
    '<div class="pod-icon-col">'
)

# 3. Replace the content wrapper: <div style="flex: 1; min-width: 0;">
text = text.replace(
    '<div style="flex: 1; min-width: 0;">',
    '<div class="pod-content">'
)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("Pod classes migrated successfully.")

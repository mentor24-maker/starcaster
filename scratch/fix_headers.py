import re

with open("public/index.html", "r") as f:
    html = f.read()

# For any <section ... class="app-page..."> followed immediately by spaces, optional <div> and <h2>
# We want to replace it.
# Actually, the most reliable way:
# Split by <section
sections = html.split("<section ")
new_sections = [sections[0]]

for sec in sections[1:]:
    if "class=" in sec and "app-page" in sec and "page-heading-row" not in sec:
        # Find <h2>...</h2>
        h2_match = re.search(r"(<h2>.*?</h2>)", sec, re.IGNORECASE)
        if h2_match:
            original_h2 = h2_match.group(1)
            # Create a new header string
            new_header = f'<div class="page-heading-row">\n          {original_h2}\n          <div class="page-heading-actions"></div>\n        </div>'
            # See if it's wrapped in an inline flex div like observeDashboardPage was:
            div_match = re.search(r"(<div[^>]*display:\s*flex[^>]*>[\s\n]*" + re.escape(original_h2) + r"[\s\n]*(.*?)</div>)", sec, re.IGNORECASE | re.DOTALL)
            
            if div_match:
                # If there's an inline flex div, replace the whole div
                inner_content = div_match.group(2).strip()
                new_sec = sec.replace(div_match.group(1), f'<div class="page-heading-row">\n          {original_h2}\n          <div class="page-heading-actions">{inner_content}</div>\n        </div>')
            else:
                # Just replace the H2
                new_sec = sec.replace(original_h2, new_header)
            
            new_sections.append(new_sec)
            continue
    new_sections.append(sec)

with open("public/index.html", "w") as f:
    f.write("<section ".join(new_sections))

print("Fixed!")

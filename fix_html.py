import re

with open('public/index.html', 'r', encoding='utf-8') as f:
    lines = f.read().split('\n')

out_lines = []
depth = 0

for i, line in enumerate(lines):
    # Before processing this line, if it's a new app-page, depth must be 0!
    if re.search(r'<section[^>]*class="?app-page', line):
        while depth > 0:
            # We are entering a new app page but previous sections are still open!
            indent = "      "
            out_lines.append(indent + "</section>")
            depth -= 1

    # Now add the current line
    out_lines.append(line)
    
    # Process opening and closing tags in the line
    # Simplified assumption: <section ...> and </section> usually appear once per line, or if multiple, we count them.
    opens = len(re.findall(r'<section\b', line))
    closes = len(re.findall(r'</section>', line))
    
    depth += (opens - closes)
    if depth < 0:
        # Ignore depth dropping below 0 (e.g. at the very end or unhandled edge cases)
        depth = 0

with open('public/index.html.fixed', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out_lines))

print("Fixed HTML written to public/index.html.fixed")

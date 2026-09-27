import re
import sys

def clean_css(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # border-radius
    content = re.sub(r'border-radius:\s*[^;]+;', 'border-radius: 0;', content)
    # box-shadow
    content = re.sub(r'box-shadow:\s*[^;]+;', 'box-shadow: none;', content)
    # linear-gradient and radial-gradient backgrounds
    content = re.sub(r'background(?:-image)?:\s*(?:linear|radial)-gradient[^;]+;', 'background: #000;', content)
    # rgba background
    content = re.sub(r'background:\s*rgba\([^)]+\);', 'background: transparent;', content)
    # rgba color
    content = re.sub(r'color:\s*rgba\([^)]+\);', 'color: #ccc;', content)
    # rgba border-color
    content = re.sub(r'border-color:\s*rgba\([^)]+\);', 'border-color: #333;', content)
    # rgba border
    content = re.sub(r'border:\s*.*?rgba\([^)]+\);', 'border: 1px solid #333;', content)
    # rgb background
    content = re.sub(r'background:\s*rgb\([^)]+\);', 'background: transparent;', content)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

clean_css('Page.css')
if __name__ == '__main__':
    print("CSS Cleaned")

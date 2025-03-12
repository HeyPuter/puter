# Script for update documentation used by mkdocs


from os import path, listdir, mkdir
import subprocess

# TODO: 0. Get project documentation path
# TODO: Load it up from a config file

DOCS_PATH = "doc/"
MKDOCS_PATH = "mkdocs.yml"
STATIC_DOCS_PATH = "static_documentation"

## Ensure there is a folder for static documentation.
## NOTE: This is not being used when mkdocs runs as server
if not path.exists(STATIC_DOCS_PATH):
    mkdir(STATIC_DOCS_PATH)
    print(f"Directory '{STATIC_DOCS_PATH}' created successfully")
else:
    print(f"Directory '{STATIC_DOCS_PATH}' already exists, using it")

# TODO: 1. Get mkdocs.yml template

docs_title = str()
nav_sections = dict()

DOCS_CONFIG = {
    "name": "material",
    "palette": {
        "primary": "indigo",
        "accent": "pink",
 "toggle": {
            "icon": "material/weather-sunny",
            "name": "Switch to dark mode"
        },
        "scheme": "default"
    }
}

# TODO: 2. Render a document with actual state for that template
#   - Read subdir of doc as categories
#   TODO: Obtain current repo version (to let reader to know what version the doc is aiming to). This could be done using git tags.

docs_title = "Puter v2.5.1 development documentation"

categories = [category for category in listdir(DOCS_PATH) if path.isdir(path.join(DOCS_PATH, category))]

print(f"DOC: Updating MKDOCS documentation for the following categories: {', '.join(categories)}")
#   - Create navbar using categories (assuming each one has a README)
for category in categories:
    category_path = f"{category}/README.md"
    nav_sections["  - "+category] = category_path

DOCUMENT_TEMPLATE = {
    "docs_dir" : DOCS_PATH,
    "site_dir" : STATIC_DOCS_PATH,
    "site_name" : docs_title,
    "nav" : nav_sections,
    "theme" : DOCS_CONFIG,
}
print(DOCUMENT_TEMPLATE)


# TODO: 3. Replace mkdocs document if exists, else create one
def dict_to_yaml(data, indent=0):
    yaml_str = ""
    spaces = "  " * indent  # Defining indentation.
    
    if isinstance(data, dict):
        for key, value in data.items():
            yaml_str += f"{spaces}{key}:"
            if isinstance(value, (dict, list)):  # If value is nested, use recursion
                yaml_str += "\n" + dict_to_yaml(value, indent + 1)
            else:
                yaml_str += f" {value}\n"
    
    elif isinstance(data, list):
        for item in data:
            yaml_str += f"{spaces}- "
            if isinstance(item, (dict, list)):
                yaml_str += "\n" + dict_to_yaml(item, indent + 1)
            else:
                yaml_str += f"{item}\n"
    
    return yaml_str

document_string = dict_to_yaml(DOCUMENT_TEMPLATE)
print(document_string)

def create_mkdocs_file(content):
    
    with open(MKDOCS_PATH, "w") as file: # NOTE: this is overriding mkdoc file if exists, this avoids a lot of issues.
        file.write(content)
    
    print(f"File '{MKDOCS_PATH}' created successfully.")

create_mkdocs_file(document_string)

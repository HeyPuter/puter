# This documentation

## About

This documentation tries to gather in an easy to navigate place for a developer (no matter his area of work, it can be frontend, backend, devops, etc...) the documentation related to the development of the opensource Puter project.

Documentation runs on mkdocs tool, an easy and powerful documentation tool written in Python. It was decided to use this tool since most of the existing documentation was in markdown format, and seeing that new contributors were also adding new documentation in markdown format.

## Get started with docs

1. Clone puter's repo.
2. Install mkdocs and mkdocs-material.
```
pip install mkdocs && pip install mkdocs-material
```
3. Navigate to the doc/dev_doc/docs directory.
4. Build the documentation
```
mkdocs build && mkdocs serve
```
5. Now you should have it live on the IP http://127.0.0.1:8000

In the ```doc/dev_doc``` directory you will find all the source files of the documentation in markdown format. You can edit them and create new ones under that directory, and incorporate them into the documentation either using the navbar of the documentation (see the doc/dev_doc/mkdocs.yml file) or using internal links with markdown.

---

Using mkdocs you can install themes. For this documentation, you will need to install material theme:

```
pip install mkdocs-material
```

---

If you find any bug or error in this documentation, do not hesitate to send your complaint to **jose.s.contacto@gmail.com**, or **colaborate** with the documentation yourself.

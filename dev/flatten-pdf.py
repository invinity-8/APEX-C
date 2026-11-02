"""
Test helper: turns a fillable PDF into a 'printed' one – every widget's own appearance stream (text values and
checkbox states) is stamped into the page content, then the form and its widgets are removed. This mirrors an
Aurora sheet exported/printed without form fields. Usage: python3 -I dev/flatten-pdf.py in.pdf out.pdf
"""
import sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject

src, dst = sys.argv[1], sys.argv[2]
w = PdfWriter(clone_from=PdfReader(src))
n = 0
for page in w.pages:
    annots = page.get('/Annots')
    if not annots:
        continue
    keep, ops = ArrayObject(), []
    res = page['/Resources'].get_object()
    if '/XObject' not in res:
        res[NameObject('/XObject')] = DictionaryObject()
    xobjs = res['/XObject'].get_object()
    for ref in annots:
        a = ref.get_object()
        if a.get('/Subtype') != '/Widget':
            keep.append(ref)
            continue
        flags = int(a.get('/F', 0))
        ap = a.get('/AP')
        if ap is None or flags & 2:  # no appearance or hidden
            continue
        normal = ap.get_object().get('/N')
        if normal is None:
            continue
        normal = normal.get_object()
        if '/Type' not in normal and '/Subtype' not in normal:  # state dictionary (checkbox)
            state = a.get('/AS')
            if state is None or state not in normal:
                continue
            normal = normal[state].get_object()
        x0, y0, x1, y1 = [float(v) for v in a['/Rect']]
        bbox = [float(v) for v in normal.get('/BBox', [0, 0, x1 - x0, y1 - y0])]
        sx = (x1 - x0) / ((bbox[2] - bbox[0]) or 1)
        sy = (y1 - y0) / ((bbox[3] - bbox[1]) or 1)
        name = f'/Flat{n}'
        n += 1
        xobjs[NameObject(name)] = w._add_object(normal) if not hasattr(normal, 'indirect_reference') or normal.indirect_reference is None else normal.indirect_reference
        ops.append(f'q {sx} 0 0 {sy} {x0 - bbox[0] * sx} {y0 - bbox[1] * sy} cm {name} Do Q')
    page[NameObject('/Annots')] = keep
    stamp = DecodedStreamObject()
    stamp.set_data(('\n'.join(ops) + '\n').encode())
    contents = page.get('/Contents')
    arr = ArrayObject()
    if contents is not None:
        c = contents.get_object()
        if isinstance(c, ArrayObject):
            arr.extend(c)
        else:
            arr.append(contents)
    arr.append(w._add_object(stamp))
    page[NameObject('/Contents')] = arr
w._root_object.pop('/AcroForm', None)
w.write(dst)
print('stamped widgets:', n)

"""Vista aérea de Alhelí: volumen exterior levantado desde los planos del PDF y órbita de cámara.

Lee las plantas de demo-building/blender/plan_data.json (contornos de cada departamento, terrazas,
núcleos) y el plano de planta baja como suelo. Las alturas y materiales siguen los renders del PDF:
planta baja y planta alta de 3,2 m, terraza comunal en cubierta, ladrillo terracota, losas claras y vidrio.
El PDF no trae fachadas ni cortes: puertas y ventanas son aproximadas.

Uso (desde la carpeta showroom):
  blender -b -P tools/build_aerial.py -- RUTA/demo-building/blender [stills|masks|frames|all]
Salida en ../material/render_aereo/ (no se publica; las vistas finales van a assets/img como aerial-<i>.jpg):
  view-<i>.png        vistas fijas (1920x1080)
  mask-<i>.png        máscara de color por departamento (para trazar las zonas clicables)
  frames/t<i>/####.png cuadros de la órbita entre la vista i y la i+1
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
BLENDER_DIR = os.path.abspath(argv[0])
WHAT = (argv[1] if len(argv) > 1 else 'all').split(',')
SHOWROOM = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(SHOWROOM, '..', 'material', 'render_aereo')   # cuadros pesados: fuera de lo que se publica
os.makedirs(OUT, exist_ok=True)

D = json.load(open(os.path.join(BLENDER_DIR, 'plan_data.json'), encoding='utf-8'))
PW, PH = 1125, 598            # marco del plano (15 unidades = 1 m)
FL = 48                       # altura de piso a piso (3,2 m)
PA_DZ = -22                   # la planta alta del PDF está desplazada 22 u respecto de la baja
CENTER = Vector((582, -268, 30))
VIEWS = [200, 290, 20, 110]   # azimut de cada vista (grados); 200 = desde la calle de ingreso
ELEV = 36                     # elevación de la cámara (grados)
DIST = 1500
TRANS_FRAMES = 60             # 2,5 s a 24 cps por cada cuarto de vuelta
RES = (1920, 1080)

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------- materiales ----------------
def mat(name, rgb, rough=0.8, metal=0.0, emit=None, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 1.0
    return m


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


M = {
    'terra': mat('terra', srgb('#b4643f'), 0.85),
    'terra2': mat('terra2', srgb('#c9805a'), 0.85),
    'slab': mat('slab', srgb('#e6dfd3'), 0.7),
    'roof': mat('roof', srgb('#9d958a'), 0.95),
    'glass': mat('glass', srgb('#2f3d44'), 0.08, 0.2, emit=srgb('#3a2a18')),
    'warm': mat('warm', srgb('#f0c98a'), 0.5, emit=srgb('#ffb866')),
    'leaf': mat('leaf', srgb('#5d7f3c'), 1.0),
    'leaf2': mat('leaf2', srgb('#6f9248'), 1.0),
    'trunk': mat('trunk', srgb('#5a4332'), 1.0),
    'deck': mat('deck', srgb('#a77b52'), 0.8),
    'rail': mat('rail', srgb('#9fb3b8'), 0.1, 0.0),
    'far': mat('far', (0.97, 0.97, 0.97), 1.0),
}
M['glass'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 0.25


# ---------------- geometría ----------------
def to_xy(p, dy=0):
    return (p[0], -(p[1] + dy))


def prism(name, pts, z0, z1, m_side, m_top=None, dy=0, windows=False, coll=None):
    """Prisma desde un polígono del plano. Con windows=True, cada cara lateral larga lleva un paño vidriado."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((*to_xy(p, dy), z0)) for p in pts]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        f.normal_flip()
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top_verts = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top_verts, vec=(0, 0, z1 - z0))
    bm.normal_update()
    me_mats = [m_side, m_top or m_side, M['glass']]
    sides = []
    for face in bm.faces:
        if abs(face.normal.z) > 0.9:
            face.material_index = 1 if face.normal.z > 0 else 0
        else:
            face.material_index = 0
            sides.append(face)
    if windows:
        big = [s for s in sides if s.calc_area() > (z1 - z0) * 18]
        res = bmesh.ops.inset_individual(bm, faces=big, thickness=8, depth=-2.2)
        for s in big:
            s.material_index = 2
    bm.to_mesh(me)
    bm.free()
    for m in me_mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    (coll or scene.collection).objects.link(o)
    return o


def offset(pts, d):
    """Desplaza un polígono hacia afuera d unidades (aprox. por bisectriz)."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    s = 1 if area > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1 = (p1 - p0).normalized()
        e2 = (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x)) * s
        n2 = Vector((e2.y, -e2.x)) * s
        b = (n1 + n2)
        if b.length < 1e-6:
            b = n1
        b.normalize()
        k = d / max(0.35, b.dot(n1))
        q = p1 + b * k
        out.append([q.x, q.y])
    return out


units = bpy.data.collections.new('units')
scene.collection.children.link(units)
UNIT_OBJS = {}


def add_unit(n, obj):
    UNIT_OBJS.setdefault(n, []).append(obj)
    for c in obj.users_collection:
        c.objects.unlink(obj)
    units.objects.link(obj)


# planta baja: departamentos 1-4
for n in range(1, 5):
    for k, pts in enumerate(D['ENC'][str(n)]):
        add_unit(n, prism(f'u{n}_{k}', pts, 0, FL - 4, M['terra'], M['roof'], windows=True))
        add_unit(n, prism(f'u{n}_{k}_slab', offset(pts, 3), FL - 4, FL, M['slab']))
        add_unit(n, prism(f'u{n}_{k}_green', offset(pts, -2), FL, FL + 4, M['leaf2']))
        add_unit(n, prism(f'u{n}_{k}_roof', offset(pts, -8), FL, FL + 4.6, M['roof']))
# planta alta: departamentos 5-10 (desplazados como en el PDF)
for n in range(5, 11):
    for k, pts in enumerate(D['ENC'][str(n)]):
        add_unit(n, prism(f'u{n}_{k}', pts, FL, 2 * FL - 5, M['terra2'], M['roof'], dy=PA_DZ, windows=True))
        add_unit(n, prism(f'u{n}_{k}_slab', offset(pts, 3.5), 2 * FL - 5, 2 * FL, M['slab'], dy=PA_DZ))
        # jardinera perimetral en cubierta, como en los renders
        add_unit(n, prism(f'u{n}_{k}_green', offset(pts, -2.5), 2 * FL, 2 * FL + 4, M['leaf2'], dy=PA_DZ))
        add_unit(n, prism(f'u{n}_{k}_roof', offset(pts, -9), 2 * FL, 2 * FL + 4.6, M['roof'], dy=PA_DZ))
# terrazas de cada departamento: losa y baranda vidriada
for n, polys in D['TER'].items():
    n = int(n)
    lvl_z = 0 if n <= 4 else FL
    dy = 0 if n <= 4 else PA_DZ
    for k, pts in enumerate(polys):
        if n <= 4:
            continue  # los patios de planta baja ya están en el plano del suelo
        add_unit(n, prism(f't{n}_{k}', pts, lvl_z - 3, lvl_z + 1, M['slab'], M['deck'], dy=dy))
        prism(f't{n}_{k}_rail', offset(pts, -0.5), lvl_z + 1, lvl_z + 15, M['rail'], dy=dy)
# núcleos de escalera y ascensor
for k, pts in enumerate(D['CORES']):
    prism(f'core{k}', pts, 0, 2 * FL + 22, M['slab'], M['roof'])
# terraza comunal en cubierta: salón vidriado con techo de madera
salon = [[316, 128], [531, 128], [531, 411], [316, 411]]
prism('tc_deck', salon, 2 * FL, 2 * FL + 2, M['deck'])
prism('tc_salon', [[330, 150], [470, 150], [470, 260], [330, 260]], 2 * FL, 2 * FL + 40, M['glass'], M['roof'])
prism('tc_roof', [[322, 140], [480, 140], [480, 272], [322, 272]], 2 * FL + 40, 2 * FL + 44, M['deck'])

# suelo: el plano de planta baja del PDF y un entorno neutro alrededor
img = bpy.data.images.load(os.path.join(SHOWROOM, 'assets', 'plan', 'plan-pb.jpg'))
bpy.ops.mesh.primitive_plane_add(size=1, location=(PW / 2, -PH / 2, -0.5))
g = bpy.context.active_object
g.scale = (PW, PH, 1)
gm = bpy.data.materials.new('ground')
gm.use_nodes = True
nt = gm.node_tree
bs = nt.nodes['Principled BSDF']
bs.inputs['Roughness'].default_value = 1.0
tx = nt.nodes.new('ShaderNodeTexImage')
tx.image = img
hs = nt.nodes.new('ShaderNodeHueSaturation')
hs.inputs['Saturation'].default_value = 1.9
hs.inputs['Value'].default_value = 0.97
nt.links.new(tx.outputs['Color'], hs.inputs['Color'])
nt.links.new(hs.outputs['Color'], bs.inputs['Base Color'])
g.data.materials.append(gm)
bpy.ops.mesh.primitive_plane_add(size=1, location=(PW / 2, -PH / 2, -1.5))
far = bpy.context.active_object
far.scale = (PW * 6, PH * 8, 1)
far.data.materials.append(M['far'])

# árboles en los jardines del plano (zonas verdes del dibujo, fuera de los edificios)
px = list(img.pixels[:])
iw, ih = img.size


def is_green(x, y):
    i = ((ih - 1 - int(y / PH * ih)) * iw + int(x / PW * iw)) * 4
    r, gg, b = px[i], px[i + 1], px[i + 2]
    return gg > r + 0.025 and gg > b + 0.02 and gg > 0.55


def inside(pt, poly):
    x, y = pt
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


blocked = [p for n in D['ENC'] for p in D['ENC'][n]] + D['CORES']
trees = 0
for _ in range(9000):
    if trees >= 70:
        break
    x, y = random.uniform(20, PW - 20), random.uniform(20, PH - 20)
    if not is_green(x, y) or any(inside((x, y), p) for p in blocked):
        continue
    s = random.uniform(0.75, 1.3)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=1.6 * s, depth=26 * s, location=(x, -y, 13 * s))
    bpy.context.active_object.data.materials.append(M['trunk'])
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=13 * s, location=(x, -y, 30 * s))
    c = bpy.context.active_object
    c.scale = (1, 1, 0.82)
    c.data.materials.append(M['leaf'] if random.random() < 0.55 else M['leaf2'])
    trees += 1
print('árboles', trees)

# ---------------- luz, cámara y render ----------------
sun_d = bpy.data.lights.new('sun', 'SUN')
sun_d.energy = 3.4
sun_d.angle = math.radians(2.5)
sun_d.color = (1.0, 0.93, 0.84)
sun = bpy.data.objects.new('sun', sun_d)
sun.rotation_euler = (math.radians(52), 0, math.radians(-128))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('w')
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (*srgb('#c7d6e6'), 1)
bg.inputs['Strength'].default_value = 0.85
scene.world = world

cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 46
cam_d.clip_start = 5
cam_d.clip_end = 20000
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def place_cam(az):
    a, e = math.radians(az), math.radians(ELEV)
    cam.location = CENTER + Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * DIST
    d = CENTER - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


r = scene.render
r.resolution_x, r.resolution_y = RES
r.resolution_percentage = 100
r.image_settings.file_format = 'PNG'
r.fps = 24
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        r.engine = eng
        break
    except TypeError:
        continue
ee = scene.eevee
for attr, val in (('taa_render_samples', 48), ('use_shadows', True), ('use_raytracing', True), ('shadow_ray_count', 2), ('use_gtao', True)):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except TypeError:
    pass


def render_to(path):
    r.filepath = path
    bpy.ops.render.render(write_still=True)


if 'stills' in WHAT or 'all' in WHAT:
    for i, az in enumerate(VIEWS):
        place_cam(az)
        render_to(os.path.join(OUT, f'view-{i}.png'))
        print('vista', i, 'lista')

if 'frames' in WHAT or 'all' in WHAT:
    for i, az in enumerate(VIEWS):
        az2 = VIEWS[(i + 1) % len(VIEWS)]
        delta = (az2 - az + 540) % 360 - 180
        fdir = os.path.join(OUT, 'frames', f't{i}')
        os.makedirs(fdir, exist_ok=True)
        for f in range(TRANS_FRAMES + 1):
            t = f / TRANS_FRAMES
            t = t * t * (3 - 2 * t)  # aceleración y frenado suaves
            place_cam(az + delta * t)
            render_to(os.path.join(fdir, f'{f:04d}.png'))
        print('órbita', i, 'lista')

if 'masks' in WHAT or 'all' in WHAT:
    # todo negro y cada departamento con un color propio, sin luz ni suavizado
    black = bpy.data.materials.new('black')
    black.use_nodes = True
    nt = black.node_tree
    nt.nodes.clear()
    o_ = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0, 0, 0, 1)
    nt.links.new(em.outputs[0], o_.inputs[0])
    unit_mat = {}
    for n in range(1, 11):
        m = bpy.data.materials.new(f'id{n}')
        m.use_nodes = True
        t = m.node_tree
        t.nodes.clear()
        oo = t.nodes.new('ShaderNodeOutputMaterial')
        e = t.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (n / 10.0, 0, 0, 1)   # rojo = n * 25,5
        t.links.new(e.outputs[0], oo.inputs[0])
        unit_mat[n] = m
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        nid = next((n for n, objs in UNIT_OBJS.items() if o in objs), None)
        mm = unit_mat[nid] if nid else black
        for slot in range(len(o.data.materials)):
            o.data.materials[slot] = mm
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    r.filter_size = 0.01
    if hasattr(ee, 'taa_render_samples'):
        ee.taa_render_samples = 1
    for i, az in enumerate(VIEWS):
        place_cam(az)
        render_to(os.path.join(OUT, f'mask-{i}.png'))
    print('máscaras listas')

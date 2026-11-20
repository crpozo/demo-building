"""Renderiza cada planta de Alhelí vista desde arriba (corte 3D al estilo showroom) para el visor.

Reutiliza blender/build_alheli.py de demo-building (muros, pisos y muebles reconstruidos desde los
planos del PDF) y, en vez de exportar GLB, coloca el plano del PDF como suelo y renderiza una cámara
ortogonal cenital. Así cada píxel del render corresponde 1:1 a las coordenadas del plano (1125 x 598),
y los contornos de los departamentos (FOOT en plan_data.json) calzan sin ajustes.

Uso (desde la carpeta showroom):
  blender -b -P tools/render_floors.py -- RUTA/demo-building/blender pb pa
Salida: assets/plan3d/floor-<planta>.png  (2250 x 1196)
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
BLENDER_DIR = os.path.abspath(argv[0])
LEVELS = argv[1:] or ['pb', 'pa']
SHOWROOM = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(SHOWROOM, 'assets', 'plan3d')
PLANS = os.path.join(SHOWROOM, 'assets', 'plan')
PW, PH = 1125, 598          # marco del plano en unidades del modelo
SCALE = 2                   # px de salida por unidad
SAMPLES = int(os.environ.get('ALHELI_SAMPLES', '64'))
os.makedirs(OUT, exist_ok=True)


def setup_render(lvl):
    scene = bpy.context.scene
    # muros cortados en gris oscuro, como un corte arquitectónico: los ambientes se leen de un vistazo
    for mat in bpy.data.materials:
        if mat.name.startswith('plaster') and mat.node_tree:
            b = mat.node_tree.nodes.get('Principled BSDF')
            if b:
                b.inputs['Base Color'].default_value = (0.045, 0.043, 0.047, 1)
                b.inputs['Roughness'].default_value = 0.8
    # suelo: el plano del PDF, así jardines, patio y estacionamientos se ven como en el brochure
    img = bpy.data.images.load(os.path.join(PLANS, f'plan-{lvl}.jpg'))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(PW / 2, -PH / 2, -0.6))
    ground = bpy.context.active_object
    ground.scale = (PW, PH, 1)
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Cubic'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ground.data.materials.append(m)

    # cámara cenital ortogonal, encuadre exacto del plano
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = PW
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = (PW / 2, -PH / 2, 800)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # sol de atardecer suave + cielo
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 2.2
    sun_data.angle = math.radians(3)
    sun_data.color = (1.0, 0.95, 0.88)
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (math.radians(22), 0, math.radians(-40))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('world')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.82, 0.86, 0.92, 1)
    bg.inputs['Strength'].default_value = 0.55
    scene.world = world

    r = scene.render
    r.resolution_x, r.resolution_y = PW * SCALE, PH * SCALE
    r.resolution_percentage = 100
    r.film_transparent = False
    r.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = -0.15

    r.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type != 'CPU' for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = True
                    scene.cycles.device = 'GPU'
                    print('render con', kind)
                    break
            except TypeError:
                continue
    except Exception as e:  # sin GPU: CPU
        print('render con CPU', e)


def render(lvl):
    setup_render(lvl)
    bpy.context.scene.render.filepath = os.path.join(OUT, f'floor-{lvl}.png')
    bpy.ops.render.render(write_still=True)
    print('render listo', bpy.context.scene.render.filepath)


# Ejecuta el armado de build_alheli.py reemplazando la exportación GLB por el render.
src = open(os.path.join(BLENDER_DIR, 'build_alheli.py'), encoding='utf-8').read()
start = src.index("    out=os.path.join(OUT,'alheli-%s.glb'%lvl)")
end = src.index("\n", src.index("    print('exportado'"))
src = src[:start] + "    RENDER(lvl)" + src[end:]
sys.argv = [os.path.join(BLENDER_DIR, 'build_alheli.py'), *LEVELS]
g = {'__name__': '__main__', '__file__': os.path.join(BLENDER_DIR, 'build_alheli.py'), 'RENDER': render}
exec(compile(src, 'build_alheli.py', 'exec'), g)

"""Reconstruye en Blender los planos de Alhelí (muros, pisos, mobiliario, autos) y exporta un GLB por planta.
Uso: python3 -c "import bpy" disponible (pip install bpy) o blender -b -P build_alheli.py
Unidades: píxeles del plano (15 px = 1 m). Eje X = x del plano, eje Y = -y del plano, Z arriba."""
import bpy, json, math, sys, os
HERE=os.path.dirname(os.path.abspath(__file__))
DATA=json.load(open(os.path.join(HERE,'plan_data.json')))
WALLS=json.load(open(os.path.join(HERE,'walls.json')))
OUT=os.path.join(HERE,'..','models')
ENC,TER,FURN,CARS,LV=DATA['ENC'],DATA['TER'],DATA['FURN'],DATA['CARS'],DATA['LV']

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()

MATS={}
def mat(name,rgb,rough=.7,metal=0,alpha=1):
    if name in MATS: return MATS[name]
    m=bpy.data.materials.new(name); m.use_nodes=True
    b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(*[c/255 for c in rgb],1)
    b.inputs['Roughness'].default_value=rough; b.inputs['Metallic'].default_value=metal
    if alpha<1:
        b.inputs['Alpha'].default_value=alpha
        try: m.surface_render_method='BLENDED'
        except Exception: m.blend_method='BLEND'
    MATS[name]=m; return m

M=dict(
 plaster=lambda:mat('plaster',(232,224,212),.9), floor=lambda:mat('floor',(214,201,180),.45),
 oak=lambda:mat('oak',(150,108,66),.6), fabric=lambda:mat('fabric',(222,213,198),1), fabric2=lambda:mat('fabric2',(178,160,138),1),
 stone=lambda:mat('stone',(205,197,184),.35), white=lambda:mat('white',(245,242,235),.25), rug=lambda:mat('rug',(160,140,118),1),
 dark=lambda:mat('dark',(60,56,52),.6), tire=lambda:mat('tire',(30,30,30),1), glass=lambda:mat('glass',(120,160,190),.1,.1,.45),
 deck=lambda:mat('deck',(196,178,150),.8), leaf=lambda:mat('leaf',(110,150,80),1),
)
CARCOL=[(138,143,150),(217,214,207),(59,63,70),(122,106,90)]

def box(name,w,d,h,x,y,z,m,bevel=0,rz=0,parent=None,smooth=False):
    """caja centrada en (x,y) con base en z. Coordenadas ya en Blender (y hacia arriba del plano = -plan_y)."""
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,y,z+h/2))
    o=bpy.context.active_object; o.name=name; o.scale=(w,d,h); o.rotation_euler[2]=rz
    o.data.materials.append(m)
    if bevel:
        bpy.ops.object.transform_apply(scale=True)
        b=o.modifiers.new('bevel','BEVEL'); b.width=bevel; b.segments=2; b.limit_method='NONE'
        bpy.ops.object.modifier_apply(modifier='bevel')
        if smooth:
            try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
            except Exception:
                try: bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
                except Exception: pass
    if parent: o.parent=parent
    return o

def cyl(name,r,h,x,y,z,m,parent=None,rx=0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r,depth=h,location=(x,y,z+h/2),vertices=14)
    o=bpy.context.active_object; o.name=name; o.rotation_euler[0]=rx; o.data.materials.append(m)
    try: bpy.ops.object.shade_smooth()
    except Exception: pass
    if parent: o.parent=parent
    return o

def empty(name,x,y,z,rz=0):
    bpy.ops.object.empty_add(location=(x,y,z)); e=bpy.context.active_object; e.name=name; e.rotation_euler[2]=rz; return e

def polygon(name,pts,z,h,m):
    """prisma desde un polígono del plano (x, plan_y)."""
    verts=[(p[0],-p[1],z) for p in pts]
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],[list(range(len(verts)))]); me.update()
    o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o); o.data.materials.append(m)
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    s=o.modifiers.new('solid','SOLIDIFY'); s.thickness=-h; s.offset=1
    bpy.ops.object.modifier_apply(modifier='solid'); return o

# ---------- mobiliario (locales: x derecha, y "norte" = +y, z arriba) ----------
def bed(p,w,d):
    for sx in (-1,1):
        box('nightstand',7,7,9,sx*(w/2+5),d/2-4,0,M['oak'](),.4,parent=p); box('lamp',3,3,5,sx*(w/2+5),d/2-4,9,M['white'](),.6,parent=p)
    box('bed_base',w,d,4,0,0,0,M['oak'](),.6,parent=p)
    box('mattress',w-2,d-2,5,0,0,4,M['fabric'](),1.2,parent=p,smooth=True)
    box('headboard',w,2.2,16,0,d/2-1.1,0,M['oak'](),.4,parent=p)
    for sx in (-1,1): box('pillow',w*.36,7,3,sx*w*.22,d/2-7,9,M['white'](),1.2,parent=p,smooth=True)
    box('duvet',w*.92,d*.42,2.2,0,-d*.2,9,M['fabric2'](),.9,parent=p,smooth=True)
def sofa(p,w,d,m=None,x=0,y=0,rz=0):
    m=m or M['fabric'](); e=empty('sofa',x,y,0,rz); e.parent=p
    box('seat',w,d,7,0,0,0,m,1.2,parent=e,smooth=True)
    box('back',w,3.2,14,0,d/2-1.6,0,m,1,parent=e,smooth=True)
    box('arm',3.2,d,10,-w/2+1.6,0,0,m,1,parent=e,smooth=True); box('arm',3.2,d,10,w/2-1.6,0,0,m,1,parent=e,smooth=True)
    n=max(1,round(w/11))
    for i in range(n): box('cushion',(w-7)/n-1,d-5,2.5,-(w-7)/2+(w-7)/n*(i+.5),-1,7,m,1,parent=e,smooth=True)
    return e
def sala(p,*_):
    # símbolo del plano: sofá de dos cuerpos al oeste mirando al este, dos sillones al norte y dos al sur, mesa de centro cuadrada
    box('rug',40,40,.6,2,0,0,M['rug'](),0,parent=p)
    sofa(p,22,10,x=-14,y=0,rz=-math.pi/2)
    sofa(p,9,9,x=-2,y=14,rz=math.pi); sofa(p,9,9,x=9,y=14,rz=math.pi)
    sofa(p,9,9,x=-2,y=-14,rz=0); sofa(p,9,9,x=9,y=-14,rz=0)
    box('coffee',9,9,1.4,3,0,7,M['oak'](),.3,parent=p); box('coffee_base',6,6,7,3,0,0,M['dark'](),0,parent=p)
def chair(p,x,y,rz):
    e=empty('chair',x,y,0,rz); e.parent=p
    box('seat',5,5,1.2,0,0,7,M['fabric2'](),.4,parent=e); box('back',5,.8,7,0,2.3,8.2,M['oak'](),.2,parent=e)
    for sx in (-1,1):
        for sy in (-1,1): box('leg',.6,.6,7,sx*2,sy*2,0,M['oak'](),0,parent=e)
def dining(p,w,d):
    box('top',w*.62,d*.6,1.4,0,0,10.5,M['oak'](),.4,parent=p)
    box('leg',2.4,2.4,10.5,0,0,0,M['oak'](),.2,parent=p)
    n=3 if max(w,d)>24 else 2
    for i in range(n):
        t=(i-(n-1)/2)*(max(w,d)*.3)
        if d>w: chair(p,-(w*.31+4),t,math.pi/2); chair(p,(w*.31+4),t,-math.pi/2)
        else: chair(p,t,(d*.3+4),0); chair(p,t,-(d*.3+4),math.pi)
    if n==3:
        if d>w: chair(p,0,(d*.3+4),0); chair(p,0,-(d*.3+4),math.pi)
        else: chair(p,-(w*.31+4),0,math.pi/2); chair(p,(w*.31+4),0,-math.pi/2)
def counter(p,w,d):
    box('body',w,d,13,0,0,0,M['oak'](),.3,parent=p); box('top',w+1,d+1,1.6,0,0,13,M['stone'](),.3,parent=p)
    L=max(w,d); along=(w>=d)
    if L>30:
        s_=min(w,d)*.6
        sx,sy=((-L*.25,0) if along else (0,-L*.25)); box('sink',s_,s_,.8,sx,sy,14.6,M['dark'](),.2,parent=p)
        hx,hy=((L*.2,0) if along else (0,L*.2)); box('hob',s_,s_,.6,hx,hy,14.6,M['dark'](),.2,parent=p)
        for k in range(4): box('burner',2,2,.4,hx+(k%2-.5)*4,hy+(k//2-.5)*4,15.2,M['white'](),.2,parent=p)
    if L>38:
        box('hood',s_+4,min(w,d),3,hx,hy,26,M['white'](),.3,parent=p)
def toilet(p,*_):
    box('tank',5,2.2,10,0,2.6,0,M['white'](),.5,parent=p,smooth=True); box('bowl',5,6,6,0,-1.5,0,M['white'](),1.5,parent=p,smooth=True)
def basin(p,*_):
    box('cab',8,5,11,0,0,0,M['oak'](),.3,parent=p); box('top',8.5,5.5,1,0,0,11,M['stone'](),.2,parent=p); cyl('bowl',2,1.8,0,0,11.8,M['white'](),parent=p)
def washer(p,*_):
    box('w',8,8,12,0,0,0,M['white'](),.5,parent=p); cyl('door',2.6,.6,0,-4,5,M['dark'](),parent=p,rx=math.pi/2)
def round_(p,*_):
    cyl('top',9,1.4,0,0,10.5,M['oak'](),parent=p); cyl('leg',1.4,10.5,0,0,0,M['dark'](),parent=p)
    for (x,y,rz) in ((0,12,0),(0,-12,math.pi),(12,0,-math.pi/2),(-12,0,math.pi/2)): chair(p,x,y,rz)
def osofa(p,*_): sofa(p,22,10,m=M['fabric2']())
def ochair(p,*_): sofa(p,9,9,m=M['fabric2']())
def ochairs(p,*_):
    for (x,y,rz) in ((-7,-7,math.pi),(7,-7,math.pi),(-7,7,0),(7,7,0)): chair(p,x,y,rz)
    cyl('t',4.5,1.2,0,0,9,M['oak'](),parent=p); cyl('tl',1,9,0,0,0,M['dark'](),parent=p)
def sofa_item(p,w,d): sofa(p,w,d)
def closet(p,w,d):
    box('closet',w,d,36,0,0,0,M['oak'](),.4,parent=p); box('door_line',w*.02+.6,d+.4,30,0,0,3,M['dark'](),0,parent=p)
def fridge(p,*_):
    box('fridge',9,9,26,0,0,0,M['white'](),.8,parent=p,smooth=True); box('handle',.8,.8,10,-3.5,-4.8,12,M['dark'](),0,parent=p)
BUILD=dict(closet=closet,fridge=fridge,bed=bed,sofa=sofa_item,sala=sala,dining=dining,counter=counter,toilet=toilet,basin=basin,washer=washer,round=round_,osofa=osofa,ochair=ochair,ochairs=ochairs)

def car(p,i):
    m=mat('car%d'%(i%4),CARCOL[i%4],.35,.6)
    box('body',17,38,7,0,0,3,m,1.5,parent=p,smooth=True); box('cabin',14,19,6,0,-1,10,m,1.5,parent=p,smooth=True)
    box('win',14.4,15,3.8,0,-1,11,M['glass'](),.8,parent=p)
    for (x,y) in ((-8,12),(8,12),(-8,-12),(8,-12)): cyl('wheel',3,2.6,x,y,.4,M['tire'](),parent=p,rx=0).rotation_euler=(0,math.pi/2,0)
    for sx in (-1,1): box('light',3,.8,1.5,sx*6,19,6,M['white'](),.3,parent=p)

# ---------- construcción por planta ----------
for lvl in (sys.argv[1:] or ('pb','pa','tc')):
    clear()
    z0=0  # cada GLB se posiciona en su nivel desde Three.js
    # muros
    h=38 if lvl=='tc' else 40
    V=[];Fc=[]
    for i,r in enumerate(WALLS[lvl]):
        outside=lvl=='pb' and (r[1]>350 or r[0]<200 or r[0]>910 or r[1]<55)
        hh=0 if outside else h
        if hh<=0: continue
        x0,y0,x1,y1=r[0],-r[3],r[2],-r[1]; b=len(V)
        V+=[(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z0+hh),(x1,y0,z0+hh),(x1,y1,z0+hh),(x0,y1,z0+hh)]
        Fc+=[[b,b+3,b+2,b+1],[b+4,b+5,b+6,b+7],[b,b+1,b+5,b+4],[b+1,b+2,b+6,b+5],[b+2,b+3,b+7,b+6],[b+3,b,b+4,b+7]]
    me=bpy.data.meshes.new('walls'); me.from_pydata(V,[],Fc); me.update()
    wo=bpy.data.objects.new('walls',me); bpy.context.collection.objects.link(wo); wo.data.materials.append(M['plaster']())
    # pisos y terrazas
    for n,polys in ENC.items():
        if lvl!=('pb' if int(n)<=4 else 'pa'): continue
        for k,pts in enumerate(polys): polygon('floor_u%s_%d'%(n,k),pts,z0+.4,1.2,M['floor']())
    if lvl=='tc':
        polygon('floor_salon',[[330,160],[560,160],[560,432],[330,432]],z0+.4,1.2,M['floor']())
    # mobiliario
    def wall_dist(cx,cy,dx,dy,maxd=40):
        best=maxd
        for r in WALLS[lvl]:
            x0,y0,x1,y1=r
            if dx: # moving along x
                if y0-2<=cy<=y1+2:
                    if dx>0 and x0>=cx: best=min(best,x0-cx)
                    if dx<0 and x1<=cx: best=min(best,cx-x1)
            else:
                if x0-2<=cx<=x1+2:
                    if dy>0 and y0>=cy: best=min(best,y0-cy)
                    if dy<0 and y1<=cy: best=min(best,cy-y1)
        return best
    for it in FURN[lvl]:
        t,cx,cy=it[0],it[1],it[2]; w=it[3] if len(it)>3 and it[3] else 10; d=it[4] if len(it)>4 and it[4] else 10; rot=it[5] if len(it)>5 else 0
        if t=='bed':
            # cabecera (plan -y con rot 0) contra el muro más cercano entre las cuatro direcciones
            cands={0:wall_dist(cx,cy,0,-1)-d/2,180:wall_dist(cx,cy,0,1)-d/2,270:wall_dist(cx,cy,-1,0)-w/2,90:wall_dist(cx,cy,1,0)-w/2}
            rot=min(cands,key=cands.get)
            if rot in (90,270): w,d=d,w
        p=empty('f_'+t,cx,-cy,z0+1.6,-math.radians(rot or 0))
        BUILD[t](p,w,d)
    if lvl=='pb':
        for i,c in enumerate(CARS):
            p=empty('car',c[0],-c[1],z0,-math.radians(c[2])); car(p,i)
    # unir todo en pocos objetos por material y exportar
    bpy.ops.object.select_all(action='SELECT')
    for o in list(bpy.context.selected_objects):
        if o.type=='EMPTY':
            bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)  # aplica jerarquías de empties
    for o in [o for o in bpy.data.objects if o.type=='EMPTY']: bpy.data.objects.remove(o)
    out=os.path.join(OUT,'alheli-%s.glb'%lvl)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_apply=True,export_yup=True,use_selection=True,export_draco_mesh_compression_enable=False)
    print('exportado',out,len(bpy.data.objects),'objetos')

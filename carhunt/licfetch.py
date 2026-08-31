import urllib.request,re,sys,concurrent.futures

TARGETS = [
 "FREDRAJlou/portfolio|public/bmw_m5_cs",
 "Toby-Query/StreetCred|public/cars/bmw_m6_gran_coupe",
 "AhmedLeithy/TypeRacerAR|SwiftKeyARTomfoolery/static/models/audi_rs7",
 "chriz-ty/ChromaRide_3D|public/audi_rs5",
 "NHLStenden-HBO-ICT/project-digital-twin-groep1-digitaltwin|src/main/resources/static/models/audi_rs5",
 "anvnh/auto_showroom|client/public/3d/audi_s8",
 "anvnh/auto_showroom|client/public/3d/audi_a5",
 "anvnh/auto_showroom|client/public/3d/bmw_m8_f92",
 "krisAndreev/MyMiniCar|src/MyMiniCar.Web/wwwroot/models/audi-a4-2000",
 "krisAndreev/MyMiniCar|src/MyMiniCar.Web/wwwroot/models/mercedes-w124-300ce",
 "flavionogueiraa/projeto_computacao_grafica|gltf/mercedes-benz_amg_cls",
 "flavionogueiraa/projeto_computacao_grafica|gltf/srt_perfomance_audi_a7_quattro",
 "bujue600-arch/carVison|car-vision-frontend/public/models/mercedes-e-class",
 "gibranalfarabi/portofolio-ar|assets/3D-model/mercedes_benz_e-class_w211",
 "Monnte/car-dataset-generator|assets/models/bmw",
 "teehee567/ray-tracer|scenes/bmw_m4_csl_2023",
 "Burgess-bin/threeJsDemo|public/model/bmw_m3",
 "reisenhe/threejs-room-setup|public/models/2021_bmw_m4_competition",
 "nico-bt/luxor-cars|src/models/bmw_seria_8_vr_ready",
 "kevingida/threejs|1.addModel/public/bmw_e24_635csi",
 "carp007/wasteland-survivor|Assets/Models/Vehicles/GenericPassengerCarPack",
 "1221074/sem5pi-24-25-g051|3DVisualizationModule/angular-three/public/models/ambulance",
]

BRANCHES=["main","master","HEAD"]

def fetch(t):
    repo,path=t.split("|")
    for b in BRANCHES:
        u="https://raw.githubusercontent.com/%s/%s/%s/license.txt"%(repo,b,path)
        try:
            r=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30)
            if r.status==200:
                txt=r.read().decode('utf-8','replace')
                title=re.search(r'title:\s*(.+)',txt)
                author=re.search(r'author:\s*(.+)',txt)
                lic=re.search(r'license type:\s*(.+)',txt)
                src=re.search(r'source:\s*(.+)',txt)
                return (t,b,(title.group(1).strip() if title else '?'),
                        (author.group(1).strip() if author else '?'),
                        (lic.group(1).strip() if lic else '?'),
                        (src.group(1).strip() if src else '?'))
        except Exception:
            continue
    return (t,None,'FETCH-FAIL','','','')

with concurrent.futures.ThreadPoolExecutor(16) as ex:
    for r in ex.map(fetch, TARGETS):
        print("%-70s\n   title : %s\n   author: %s\n   lic   : %s\n   src   : %s"%(r[0],r[2],r[3],r[4],r[5]))

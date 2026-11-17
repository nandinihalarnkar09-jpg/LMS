# Recompute WCAG 2.x contrast ratios for the LMS palette: python3 scripts/check-contrast.py
import colorsys,sys
def hsl_to_rgb(h,s,l):
    r,g,b=colorsys.hls_to_rgb(h/360,l/100,s/100); return (r,g,b)
def hex_to_rgb(x):
    x=x.lstrip('#'); return tuple(int(x[i:i+2],16)/255 for i in (0,2,4))
def lum(c):
    f=lambda v: v/12.92 if v<=0.03928 else ((v+0.055)/1.055)**2.4
    r,g,b=map(f,c); return 0.2126*r+0.7152*g+0.0722*b
def ratio(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def rgb_to_hsl(c):
    h,l,s=colorsys.rgb_to_hls(*c); return f"{round(h*360)} {round(s*100)}% {round(l*100)}%"
P={
 # light
 'canvas':'#FFFFFF','ink':'#1A1F33','muted':'#555D73','border':'#D9DCE5','surface':'#F3F4F8',
 'primary':'#28358F','primary_tint':'#E8EAF6','laterite':'#8C3B2E',
 'success':'#1D7044','warning':'#8A5300','danger':'#B42318',
 # dark
 'd_canvas':'#11142A','d_card':'#171B35','d_ink':'#E8EAF2','d_muted':'#A3A9C2','d_primary':'#A9B4F5','d_border':'#2B3152',
 'd_success':'#5CC98A','d_warning':'#F0B44C','d_danger':'#F28B82',
}
pairs=[('ink','canvas'),('muted','canvas'),('muted','surface'),('ink','surface'),('primary','canvas'),('canvas','primary'),('primary','primary_tint'),('primary','surface'),('laterite','canvas'),('success','canvas'),('warning','canvas'),('danger','canvas'),('canvas','success'),('canvas','danger'),
 ('d_ink','d_canvas'),('d_muted','d_canvas'),('d_muted','d_card'),('d_primary','d_canvas'),('d_canvas','d_primary'),('d_success','d_canvas'),('d_warning','d_canvas'),('d_danger','d_canvas')]
for a,b in pairs:
    r=ratio(hex_to_rgb(P[a]),hex_to_rgb(P[b]))
    print(f"{a:>13} on {b:<13} {r:5.2f}:1 {'AA' if r>=4.5 else ('AA-large' if r>=3 else 'FAIL')}")
print()
for k,v in P.items(): print(k, v, rgb_to_hsl(hex_to_rgb(v)))

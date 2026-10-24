import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = ['Noto Sans CJK TC']
OUT = '/Volumes/Work/terrain-gp-jianzhong/terrain-gp/docs/height_sampling/'
C1, C2, C3, C4 = '#2a78d6', '#eb6834', '#1baf7a', '#6250d6'
INK, MUTED, GRID = '#0b0b0b', '#52514e', '#e4e3df'
def style(ax):
    for s in ['top', 'right']: ax.spines[s].set_visible(False)
    for s in ['left', 'bottom']: ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=MUTED); ax.yaxis.grid(True, color=GRID, lw=0.8); ax.set_axisbelow(True)
names = [('p0', '中正紀念堂環線'), ('p1', '萬華艋舺環線'), ('p2', '大安仁愛短程')] + [('h%s' % s, '丘陵 #%s' % s) for s in ['20251019', '1', '2', '3', '4', '5', '6', '7', '8', '9']]
def load(tag, k): return json.load(open(f'{tag}/{k}.json'))
fig, axs = plt.subplots(1, 2, figsize=(12, 4.6))
for ax, stat, lim, title in [(axs[0], 'max_mm', 100, '最大值（門檻 10 cm）'), (axs[1], 'p99_mm', 50, 'p99（門檻 5 cm）')]:
    x = range(len(names)); w = 0.27
    b = [load('before', k)['ground'][stat] for k, _ in names]; v = [load('before', k)['visible'][stat] for k, _ in names]; a = [load('final', k)['visible'][stat] for k, _ in names]
    ax.bar([i - w for i in x], b, w * 0.92, color=C1, label='修改前：地面網格三角形')
    ax.bar([i for i in x], v, w * 0.92, color=C2, label='修改前：看得到的表面')
    ax.bar([i + w for i in x], a, w * 0.92, color=C3, label='修改後：看得到的表面')
    ax.axhline(lim, color=INK, lw=1, ls='--')
    ax.set_xticks(list(x)); ax.set_xticklabels([n for _, n in names], rotation=45, ha='right', fontsize=8.5); ax.set_ylabel('|物理高度 − 畫出的表面|（mm）', color=MUTED)
    ax.set_title(title, color=INK, fontsize=11, loc='left'); style(ax)
fig.legend(*axs[0].get_legend_handles_labels(), frameon=False, fontsize=9, loc='lower center', ncol=3)
fig.suptitle('車道內每 0.5 m 取樣：物理高度與實際畫出的三角形的差', color=INK, fontsize=12, x=0.01, ha='left')
fig.tight_layout(rect=(0, 0.07, 1, 1)); fig.savefig(OUT + '1_高度差_修改前後.png', dpi=150); plt.close(fig)

# ride: hills, 一般 60fps / 30fps / 20fps, jolts and attitude jumps, four variants
var = [('before', '修改前（雙線性）', C1), ('afterA', '只換三角形', C2), ('afterE', '三角形＋路面修正＋三角形平面法向量', C4), ('final', '採用：三角形＋路面修正', C3)]
rows = [(k, i, lab + ' ' + lab2) for k, lab in [('h20251019', '丘陵 #20251019'), ('h3', '丘陵 #3'), ('h6', '丘陵 #6')] for i, lab2 in [(0, '60fps'), (1, '30fps'), (2, '20fps')]]
fig, axs = plt.subplots(1, 2, figsize=(12, 4.6))
for ax, key, title in [(axs[0], 'jolt', '垂直顛簸次數（垂直加速度 > 4 g）'), (axs[1], 'nJump2', '車身姿態一格跳超過 2° 的次數')]:
    w = 0.2
    for j, (tag, lab, col) in enumerate(var):
        vals = []
        for k, i, _ in rows:
            r = load('audit_' + tag, k)['runs'][i]; vals.append(r['ev']['jolt'] if key == 'jolt' else r['ride']['nJump2'])
        ax.bar([q + (j - 1.5) * w for q in range(len(rows))], vals, w * 0.92, color=col, label=lab)
    ax.set_xticks(range(len(rows))); ax.set_xticklabels([r[2] for r in rows], rotation=45, ha='right', fontsize=8.5)
    ax.set_title(title, color=INK, fontsize=11, loc='left'); style(ax)
fig.legend(*axs[0].get_legend_handles_labels(), frameon=False, fontsize=9, loc='lower center', ncol=4)
fig.suptitle('物理稽核：丘陵練習場「一般」情境（臺北三條在所有版本都是 0）', color=INK, fontsize=12, x=0.01, ha='left')
fig.tight_layout(rect=(0, 0.07, 1, 1)); fig.savefig(OUT + '2_行駛平順度_四種做法.png', dpi=150); plt.close(fig)
print('ok')

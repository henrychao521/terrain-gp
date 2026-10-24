import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = ['Noto Sans CJK TC']
OUT = '/Volumes/Work/terrain-gp-jianzhong/terrain-gp/docs/height_sampling/'
C1, C3 = '#2a78d6', '#1baf7a'; INK, MUTED, GRID = '#0b0b0b', '#52514e', '#e4e3df'
def style(ax):
    for s in ['top', 'right']: ax.spines[s].set_visible(False)
    for s in ['left', 'bottom']: ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=MUTED); ax.yaxis.grid(True, color=GRID, lw=0.8); ax.set_axisbelow(True)
fig, axs = plt.subplots(1, 3, figsize=(13, 4.4), gridspec_kw={'width_ratios': [3, 3, 10]})
tp = [('p0', '中正'), ('p1', '萬華'), ('p2', '大安')]
for ax, f, title, conv in [(axs[0], 'streetOver', '街道高出賽道柏油（車道內取樣點 %）', lambda d: 100 * d['streetOver']['above0'] / d['streetOver']['n']),
                           (axs[1], 'contact', '輪胎與畫出路面的差（平均，mm）', lambda d: d['contact']['mean_mm'])]:
    b = [conv(json.load(open(f'r2base/{k}.json'))) for k, _ in tp]; a = [conv(json.load(open(f'r2fin/{k}.json'))) for k, _ in tp]
    x = range(3); ax.bar([i - 0.2 for i in x], b, 0.37, color=C1, label='修正前'); ax.bar([i + 0.2 for i in x], a, 0.37, color=C3, label='修正後')
    for i, v in enumerate(a): ax.text(i + 0.2, v, f'{v:g}', ha='center', va='bottom', fontsize=9, color=INK)
    ax.set_xticks(list(x)); ax.set_xticklabels([n for _, n in tp]); ax.set_title(title, color=INK, fontsize=10.5, loc='left'); style(ax)
seeds = ['20251019', '1', '2', '3', '4', '5', '6', '7', '8', '9']
b = []; a = []
for s in seeds:
    cb = json.load(open(f'gravel_r2orig/h{s}.json')); ca = json.load(open(f'gravel_r2fin/h{s}.json'))
    b.append(100 * cb['escaped'] / cb['of']); a.append(100 * ca['escaped'] / ca['of'])
x = range(len(seeds)); axs[2].bar([i - 0.2 for i in x], b, 0.37, color=C1, label='修正前'); axs[2].bar([i + 0.2 for i in x], a, 0.37, color=C3, label='修正後')
axs[2].set_xticks(list(x)); axs[2].set_xticklabels(['丘陵 #' + s for s in seeds], rotation=40, ha='right', fontsize=8.5); axs[2].set_ylim(0, 105)
axs[2].set_title('最陡緩衝區（含護欄邊）停車後全油門能開回柏油的比例（%）', color=INK, fontsize=10.5, loc='left'); style(axs[2])
fig.legend(*axs[0].get_legend_handles_labels(), frameon=False, fontsize=9, loc='lower center', ncol=2)
fig.tight_layout(rect=(0, 0.06, 1, 1)); fig.savefig(OUT + '3_第二輪修正.png', dpi=150); print('ok')

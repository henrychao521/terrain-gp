"""Give TRELLIS.2's sparse attention a plain PyTorch SDPA backend (one variable-length sequence at a time), so it runs without
xformers / flash-attn builds that match the VM's torch. Usage: python patch_sdpa.py <TRELLIS.2 checkout>"""
import sys, re
root = sys.argv[1]
p = f'{root}/trellis2/modules/sparse/config.py'; s = open(p).read()
s = s.replace("in ['xformers', 'flash_attn', 'flash_attn_3']:", "in ['xformers', 'flash_attn', 'flash_attn_3', 'sdpa']:"); open(p, 'w').write(s)
p = f'{root}/trellis2/modules/sparse/attention/full_attn.py'; s = open(p).read()
anchor = "    else:\n        raise ValueError(f\"Unknown attention module: {config.ATTN}\")"
assert s.count(anchor) == 1
s = s.replace(anchor, """    elif config.ATTN == 'sdpa':
        if num_all_args == 1:
            q, k, v = qkv.unbind(dim=1)
        elif num_all_args == 2:
            k, v = kv.unbind(dim=1)
        outs, qi, ki = [], 0, 0
        for lq, lk in zip(q_seqlen, kv_seqlen):
            qq, kk, vv = (t.transpose(0, 1).unsqueeze(0) for t in (q[qi:qi + lq], k[ki:ki + lk], v[ki:ki + lk]))
            outs.append(torch.nn.functional.scaled_dot_product_attention(qq, kk, vv)[0].transpose(0, 1))
            qi += lq; ki += lk
        out = torch.cat(outs, dim=0)
""" + anchor)
open(p, 'w').write(s)
print('patched sdpa')

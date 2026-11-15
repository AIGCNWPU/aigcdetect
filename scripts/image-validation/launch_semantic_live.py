"""Use existing server configuration privately for an explicitly authorized live evaluation.
Never displays, exports to disk, or passes credentials in command-line arguments.
"""
import argparse, os, sys
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env',type=Path,required=True)
    p.add_argument('--root',type=Path,required=True)
    p.add_argument('--run',type=Path,required=True)
    a=p.parse_args()
    project=Path(__file__).resolve().parents[2]
    sys.path.insert(0,str(project/'src/modules/image/documents/python'))
    from deepseek_explainer import read_settings
    try:
        cfg=read_settings(a.env)
        if cfg.get('DEEPSEEK_ENABLED')!='true' or not cfg.get('DEEPSEEK_API_KEY') or cfg.get('DEEPSEEK_BASE_URL','https://api.deepseek.com')!='https://api.deepseek.com':
            print('Live evaluation unavailable: existing official provider configuration is not enabled.',flush=True)
            return 2
        env=dict(os.environ,DEEPSEEK_ENABLED='true',DEEPSEEK_API_KEY=cfg['DEEPSEEK_API_KEY'],DEEPSEEK_MODEL='deepseek-flash')
    except Exception:
        print('Live evaluation unavailable: server configuration could not be loaded safely.',flush=True)
        return 2
    import shutil
    node=shutil.which('node')
    if not node: return 2
    os.execve(node,[node,str(project/'scripts/image-validation/evaluate-chinese-semantic.mjs'),str(a.root.resolve()),str(a.run.resolve()),'--live'],env)

if __name__=='__main__':sys.exit(main())

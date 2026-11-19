"""两人对话的按说话人伪造检测（静音掩码方案）。

模块划分：

    config      配置加载与覆盖
    utils       区间运算、JSON 读写、随机种子
    audio       音频读写与帧数换算
    dailytalk   DailyTalkEdit / DailyTalk 数据索引
    gtbuild     标注构建（build_gt.py 的实现）
    diarization pyannote 说话人分离封装
    masking     静音掩码导出
    parsing     模型输出的容错解析
    detector    HoliAntiSpoof（本地 / HTTP）
    decision    阈值选择与判定
    metrics     EER / AUC / DER / 混淆矩阵
    evaluation  评测（evaluate.py 的实现）
    pipeline    单文件全流程
"""

__version__ = "1.0.0"

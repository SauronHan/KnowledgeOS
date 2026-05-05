FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量，防止 Python 生成 .pyc 文件，并强制输出刷新到终端
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 安装系统依赖（如 python-magic 必需的 libmagic1，以及编译 C 扩展的工具）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 拷贝依赖清单并安装
COPY requirements.txt .
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install --no-cache-dir -r requirements.txt

# 为了利用 Docker 缓存，模型下载可以放在这一步预热
# (可选: 提前拉取 all-MiniLM-L6-v2)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2', device='cpu')"

# 拷贝整个后端项目
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 默认启动命令 (网关)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

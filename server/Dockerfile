FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量，防止 Python 生成 .pyc 文件，并强制输出刷新到终端
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Hugging Face 镜像（国内无法直连时使用）
ENV HF_ENDPOINT=https://hf-mirror.com

# 安装系统依赖（python-magic 必需的 libmagic1）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# 拷贝依赖清单并安装
COPY requirements.txt .
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip install --no-cache-dir --only-binary :all: -r requirements.txt

# 拷贝整个后端项目
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 默认启动命令 (网关)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

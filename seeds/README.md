# OpenClaw Seed Data

OpenClaw Seed Data 是为 `hive-exp` 系统提供冷启动经验记录的预置数据集，用于在新环境中快速恢复常见问题的排障经验。

## 什么是种子数据

种子数据是可复用的 `ExperienceRecord` 结构化记录，描述某类问题发生场景、前置条件、修复策略与修复证据。

## 如何导入

目前 `hive-exp CLI` 的 `--file` 参数接受的是 JSON 格式，建议在导入 YAML 时先进行转换。

### 方式 1（推荐，需安装 yq）

```bash
for f in seeds/openclaw/*.yaml; do yq -o=json "$f" | hive-exp add --file /dev/stdin; done
```

### 方式 2（使用 js-yaml）

```bash
for f in seeds/openclaw/*.yaml; do node -e "const y=require('js-yaml'),fs=require('fs'); fs.writeFileSync('/tmp/exp.json',JSON.stringify(y.load(fs.readFileSync('$f','utf8')))); " && hive-exp add --file /tmp/exp.json; done
```

### 方式 3（直接读取 YAML，如果项目已添加 yaml 支持）

```bash
for f in seeds/openclaw/*.yaml; do hive-exp add --file "$f"; done
```

## 文件说明

`seeds/openclaw` 下所有种子文件的 `scope` 均为 `project`，并且 `preconditions` 包含 `OpenClaw project`。

## 如何创建自己的种子数据

你可以直接复制已有文件并修改以下字段创建新的种子数据：

- `id`
- `signals`
- `strategy.name`
- `strategy.description`
- `strategy.category`
- `outcome.status`
- `outcome.evidence`

修改后确保 `id` 和 `strategy.name` 均符合命名规范，并保持其他字段与项目 schema 对齐。 

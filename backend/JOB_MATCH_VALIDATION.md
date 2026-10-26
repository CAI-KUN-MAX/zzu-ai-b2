# 单简历多岗位匹配验证记录

日期：2026-10-26。代码和接口回归已通过；40 个当前可投岗位的数据结构、类别和学历配额验收已通过，详见 [catalogue/VALIDATION.md](catalogue/VALIDATION.md)。本记录不表示已部署。

## 已执行

在 `backend/` 下使用仓库已有虚拟环境执行：

```powershell
$env:ENABLE_DOCS='false'
..\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

本轮结果：**105 项通过，4 项真实离线 OCR 测试因未设置 `TEST_REAL_OCR=1` 而跳过**。其余范围包括16项新增专项测试，以及旧简历解析、单 JD 多简历排序、Excel 导出、诊断和三轮面试回归。测试使用临时数据库与虚构简历，不写入实际简历库。

新增专项覆盖：岗位查询及分页、整批校验原子性、任务类型隔离、相关岗位优先和同分稳定、去重、并发重复请求只建一个任务、快照变化产生新任务、原简历 ID 保留、AI 重排、单项失败不影响其他真实结果、Mock 降级、持久缓存、相同输入模型调用合并、单项超时、上游 504、整批超时保留已完成结果、基础评分超时、输入长短限制、前 8 岗限制、失败/重启后重试及独立示例结构校验。

端到端测试实际经过 DOCX 上传解析、岗位排序、上下文获取、原诊断接口、原面试服务创建与三轮回答；只替换模型边界返回虚构测试结果，面试服务本身没有被替换。核对面试持久化的原简历全文和 JD 与匹配快照一致。

仓库根目录执行以下检查均通过：

```powershell
.\.venv\Scripts\python.exe -m compileall -q backend/app backend/scripts backend/tests
git diff --check
.\.venv\Scripts\python.exe backend/scripts/make_job_match_examples.py
.\.venv\Scripts\python.exe backend/scripts/check_job_catalogue.py --as-of 2026-10-26 --require-target
```

严格岗位验收输出 structural_validation=passed、records=50、open=40、unverified=10；十类各4条、硕士及以上13条、本科27条，target_met=true，退出码为0。

BOSS 审计：22,167 条记录，15,413 个唯一岗位 ID；714 条应届且有 JD 的记录，去重后为 **506 个岗位**，其中要求硕士/博士的去重后为 **318 个岗位**。全部岗位记录缺少发布日期，未导入正式目录，也没有复制原始个人信息或访问标识。

## 修正后通过的回归问题

- 初次完整回归发现：对旧 HR 筛选流程也合并模型调用会改变其原有调用次数。保留旧方法与原测试断言，将合并仅用于新岗位排序；最终完整回归通过。
- 扩展三轮衔接测试时曾读取错误的面试持久化字段；按既有实现改为核对 interviews 的 resume_text/jd_text，随后专项及完整回归通过。

## 未执行与限制

- 未调用真实远程模型，模型质量、真实网络延迟、费用和真实模型效果未实测；单项失败、超时和重试用可控测试验证。
- 未修改前端页面，未运行前端构建；本轮交付 Pydantic/OpenAPI 契约、API 文档和独立 JSON 示例。
- 仓库无独立后端 linter/formatter 配置，环境没有 ruff/flake8；没有新增依赖，静态检查采用 Python 编译检查及 diff 空白检查。
- 当前 Windows 环境没有 Nginx，未运行 `nginx -t`，未部署或重载服务器；部署配置只增加新任务入口的高成本限流。
- 当前目录有40条已核验 open 岗位，默认岗位查询和真实静态岗位排序可直接使用；岗位到达截止日期后仍需滚动复核状态。
- 未接入 Embedding。现有算法为关键词、字符 2-gram 余弦相似度、学历规则及可选 LLM 精排，没有语义向量匹配。

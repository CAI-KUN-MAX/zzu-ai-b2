import type { Job, JobList } from "../types";

/** Both entry points must use the complete catalogue, never a preview-page count. */
export async function loadJobCatalogue(fetchPage: (params: { page: number; page_size: number }) => Promise<JobList>): Promise<JobList> {
  const first = await fetchPage({ page: 1, page_size: 100 });
  const items = [...first.items];
  const pages = Math.ceil(first.total / 100);
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPage({ page, page_size: 100 });
    if (next.total !== first.total || next.catalogue_version !== first.catalogue_version) {
      throw new Error("岗位目录已更新，请刷新后重试");
    }
    items.push(...next.items);
  }
  if (items.length !== first.total || new Set(items.map((job) => job.job_id)).size !== first.total) {
    throw new Error("岗位目录加载不完整，请刷新后重试");
  }
  return { ...first, items };
}

export function normalizeCity(city: string) {
  return city.trim().replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|[市省])$/, "");
}

const PROVINCE_CITIES: Record<string, string[]> = {
  北京: ["北京"], 上海: ["上海"], 天津: ["天津"], 重庆: ["重庆"],
  河北: ["石家庄", "沧州", "燕郊", "张家口", "保定"], 山西: ["太原"], 辽宁: ["沈阳", "大连"],
  吉林: ["长春"], 黑龙江: ["哈尔滨"],
  江苏: ["南京", "苏州", "无锡", "盐城", "常州", "南通", "连云港", "扬州"], 浙江: ["杭州", "宁波", "嘉兴", "绍兴", "海宁", "义乌", "湖州"],
  安徽: ["合肥", "滁州"], 福建: ["福州", "厦门"], 江西: ["南昌", "抚州", "九江", "赣州"],
  山东: ["济南", "青岛", "威海", "日照", "东营", "临沂", "菏泽"], 河南: ["郑州"], 湖北: ["武汉", "咸宁", "黄石", "荆门", "天门", "襄阳"], 湖南: ["长沙"],
  广东: ["广州", "深圳", "珠海", "惠州", "东莞", "中山", "江门", "梅州", "佛山"], 广西: ["南宁"], 海南: ["海口", "三亚"],
  四川: ["成都"], 贵州: ["贵阳"], 云南: ["昆明"], 西藏: ["拉萨"], 陕西: ["西安", "咸阳"],
  甘肃: ["兰州", "平凉", "金昌", "白银"], 青海: ["西宁"], 宁夏: ["银川", "固原"], 新疆: ["乌鲁木齐", "哈密"],
  内蒙古: ["呼和浩特", "赤峰"], 香港: ["香港"], 澳门: ["澳门"], 台湾: ["台北"],
};

export function locationGroups(jobs: Pick<Job, "cities">[]) {
  const locations = new Set(jobs.flatMap(jobCities));
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  for (const [province, cities] of Object.entries(PROVINCE_CITIES)) {
    const options = cities.filter((city) => locations.has(city)).sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map((city) => ({ value: city, label: city }));
    if (locations.has(province) && !cities.includes(province)) options.unshift({ value: province, label: `${province}全省（地点未细化）` });
    if (options.length) groups.push({ label: province, options });
    locations.delete(province);
    cities.forEach((city) => locations.delete(city));
  }
  const nationwide = [...locations].filter((city) => city.startsWith("全国"));
  if (nationwide.length) groups.unshift({ label: "全国范围", options: nationwide.map((city) => ({ value: city, label: city })) });
  nationwide.forEach((city) => locations.delete(city));
  if (locations.size) groups.push({ label: "海外及其他地点", options: [...locations].sort((a, b) => a.localeCompare(b, "zh-CN")).map((city) => ({ value: city, label: city })) });
  return groups;
}

export function jobCities(job: Pick<Job, "cities">) {
  return [...new Set(job.cities.flatMap((location) => {
    const parts: string[] = [];
    let depth = 0;
    let part = "";
    for (const char of location) {
      if (char === "（" || char === "(") depth += 1;
      if (char === "）" || char === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && /[/／、,，;；|]/.test(char)) {
        parts.push(part);
        part = "";
      } else part += char;
    }
    parts.push(part);
    return parts.map(normalizeCity).filter(Boolean);
  }))];
}

/** Facet counts apply the search/education/city filters, before selecting a category. */
export function filterJobCatalogue(jobs: Job[], filters: { search: string; education: string; city: string }) {
  const query = filters.search.trim().toLowerCase();
  return jobs.filter((job) =>
    (filters.education === "全部" || job.education === filters.education) &&
    (filters.city === "全部" || jobCities(job).includes(normalizeCity(filters.city))) &&
    [job.title, job.company, job.category, ...job.cities].join(" ").toLowerCase().includes(query)
  );
}

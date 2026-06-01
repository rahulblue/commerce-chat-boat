import dotenv from "dotenv";

dotenv.config();

const prefixes = [process.env.ADOBE_COMMERCE_REST_PREFIX || "/rest/default", "/rest"];

for (const prefix of [...new Set(prefixes)]) {
  const url = new URL(`${process.env.ADOBE_COMMERCE_BASE_URL}${prefix}/V1/orders`);
  url.searchParams.set("searchCriteria[pageSize]", "1");
  url.searchParams.set("searchCriteria[currentPage]", "1");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.ADOBE_COMMERCE_ADMIN_TOKEN}`,
      Accept: "application/json",
    },
  });

  const body = await response.text();
  console.log(`PREFIX ${prefix}`);
  console.log(`HTTP ${response.status}`);
  console.log(body.slice(0, 500));
}

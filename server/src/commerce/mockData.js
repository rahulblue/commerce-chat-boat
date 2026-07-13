export const mockOrders = [
  {
    incrementId: "100000123",
    status: "processing",
    grandTotal: 649.99,
    currency: "USD",
    customerName: "Alex Carter",
    createdAt: "2026-05-25",
    items: [
      { sku: "STKP14000400", name: "Expansion Portable 4TB", qty: 1 },
      { sku: "STJL2000400", name: "Ultra Touch 2TB", qty: 2 },
    ],
  },
  {
    incrementId: "100000124",
    status: "complete",
    grandTotal: 229.99,
    currency: "USD",
    customerName: "Morgan Lee",
    createdAt: "2026-05-24",
    items: [{ sku: "STGX1000400", name: "Expansion Portable 1TB", qty: 1 }],
  },
];

export const mockShipments = [
  {
    orderIncrementId: "100000123",
    shipmentId: "500000771",
    carrier: "UPS",
    trackingNumber: "1Z999AA10123456784",
    status: "in transit",
    shippedAt: "2026-05-26",
  },
  {
    orderIncrementId: "100000124",
    shipmentId: "500000772",
    carrier: "FedEx",
    trackingNumber: "781234567890",
    status: "delivered",
    shippedAt: "2026-05-25",
  },
];

export const mockReturns = [
  {
    rmaId: "RMA-9001",
    orderIncrementId: "100000124",
    status: "pending approval",
    reason: "Defective item",
    items: [{ sku: "STGX1000400", qty: 1 }],
  },
];

export const mockTopProducts = [
  { sku: "STKP14000400", name: "Expansion Portable 4TB", qtySold: 128, revenue: 16639.72 },
  { sku: "STGX1000400", name: "Expansion Portable 1TB", qtySold: 112, revenue: 10078.88 },
  { sku: "STJL2000400", name: "Ultra Touch 2TB", qtySold: 83, revenue: 10789.17 },
  { sku: "STKM2000400", name: "One Touch 2TB", qtySold: 64, revenue: 7679.36 },
  { sku: "STKZ5000400", name: "FireCuda Gaming Drive 5TB", qtySold: 41, revenue: 6149.59 },
];

export const mockProducts = [
  {
    sku: "STKP14000400",
    name: "Expansion Portable 4TB",
    price: 129.99,
    status: "enabled",
    typeId: "simple",
    qty: 342,
  },
  {
    sku: "STGX1000400",
    name: "Expansion Portable 1TB",
    price: 64.99,
    status: "enabled",
    typeId: "simple",
    qty: 511,
  },
];

export const mockCustomers = [
  {
    email: "alex.carter@example.com",
    firstName: "Alex",
    lastName: "Carter",
    groupId: 1,
    createdAt: "2025-01-14",
  },
  {
    email: "morgan.lee@example.com",
    firstName: "Morgan",
    lastName: "Lee",
    groupId: 1,
    createdAt: "2025-03-02",
  },
];

export const mockInvoices = [
  {
    orderIncrementId: "100000123",
    invoiceId: "900000201",
    grandTotal: 649.99,
    state: "paid",
    createdAt: "2026-05-25",
  },
];

export const mockCreditMemos = [
  {
    orderIncrementId: "100000124",
    creditMemoId: "700000101",
    grandTotal: 229.99,
    state: "refunded",
    createdAt: "2026-05-27",
  },
];

export const mockStoreConfig = {
  baseUrl: "https://staging.example.com/",
  baseCurrencyCode: "USD",
  defaultDisplayCurrencyCode: "USD",
  timezone: "America/Los_Angeles",
  locale: "en_US",
};

export const mockIngramConfiguration = {
  reportEnabled: true,
  missingIngramNumberReportEnabled: true,
  duplicatedIngramNumberReportEnabled: false,
  reportFrequency: "daily",
  stockReportWebsites: ["base"],
  ingramBaseEnabled: true,
  ingramSandbox: true,
  ingramEndpoint: "https://api.ingrammicro.com:443/sandbox",
  ingramCustomerNumber: "12345678",
};

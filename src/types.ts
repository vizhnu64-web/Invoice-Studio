/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type FieldCategory = 
  | 'company'
  | 'invoice'
  | 'customer'
  | 'subject'
  | 'item'
  | 'summary'
  | 'notes'
  | 'bank'
  | 'signature'
  | 'terms'
  | 'footer'
  | 'custom';

export type DataSourceType = 
  | 'excel'
  | 'googlesheets'
  | 'company'
  | 'manual'
  | 'calculated'
  | 'static';

export type DataType = 'string' | 'number' | 'date' | 'boolean' | 'currency';

export interface InvoiceFieldConfig {
  id: string; // Internal Field ID e.g. 'customer_name'
  defaultName: string; // Default Field Name
  displayName: string; // Editable Display Label e.g. 'Bill To'
  category: FieldCategory;
  dataType: DataType;
  dataSource: DataSourceType;
  sourceColumn?: string; // Mapped column in Excel / Google Sheets
  sourceWorksheet?: string;
  fetchEnabled: boolean; // Fetch from source: ON/OFF
  pdfVisibility: boolean; // Display in PDF: ON/OFF
  value: any; // Editable Value
  defaultValue: any; // Default Value
  required?: boolean;
  formattingRule?: string;
  calculationRule?: string;
  displayOrder?: number;
  isCustom?: boolean;
  mappingMode?: 'excel_column' | 'auto_generate' | 'manual' | 'default' | 'calculated' | 'empty';
  manualValue?: any;
  autoGenerateConfig?: {
    method?: string;
    prefix?: string;
    suffix?: string;
    startNumber?: number;
    template?: string;
    daysOffset?: number;
  };
  // Compatibility aliases
  key?: string;
  label?: string;
  mappedColumn?: string;
  isRequired?: boolean;
}

export type AmountCalculationMode = 'calculated' | 'excel_amount';

export interface CalculationSettings {
  mode: AmountCalculationMode;
  taxInclusive: boolean; // In excel_amount mode: does mapped amount include GST?
}

export interface InvoiceItem {
  id: string;
  serialNumber: string | number;
  itemName: string;
  itemDescription: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  rate: number;
  lineSubtotal?: number;
  discount?: number;
  discountType?: 'percentage' | 'fixed';
  discountAmount?: number;
  excelAmount?: number;
  isTaxInclusive?: boolean;
  calculationMode?: AmountCalculationMode;
  taxableAmount: number;
  gstPercentage: number;
  taxType: 'IGST' | 'CGST_SGST' | 'NONE';
  igstPercentage: number;
  igstAmount: number;
  cgstPercentage: number;
  cgstAmount: number;
  sgstPercentage: number;
  sgstAmount: number;
  itemTotal: number;
}

export interface BrandPalette {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingColor: string;
  bodyTextColor: string;
  mutedTextColor: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableBorderColor: string;
  sectionBg: string;
  invoiceBg: string;
  dividerColor: string;
  totalHighlightColor: string;
  footerBg: string;
  footerTextColor: string;
}

export interface TypographySettings {
  headingFont: string;
  bodyFont: string;
  tableFont: string;
  fontSize: number;
  headingWeight: string;
  bodyWeight: string;
  lineSpacing: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
}

export interface AssetSettings {
  logoUrl: string;
  alternateLogoUrl: string;
  signatureUrl: string;
  stampUrl: string;
  footerLogoUrl: string;
  qrCodeUrl: string;
  logoWidth: number;
  logoHeight: number;
  logoAlignment: 'left' | 'center' | 'right';
  signatureWidth: number;
  signatureHeight: number;
  stampWidth: number;
  stampHeight: number;
  qrCodeWidth: number;
  qrCodeHeight: number;
  watermarkText: string;
  showWatermark: boolean;
  showQrCode: boolean;
  showStamp: boolean;
}

export interface ContentSettings {
  invoiceTitle: string;
  invoiceSubtitle: string;
  defaultNotes: string;
  defaultTerms: string;
  paymentInstructions: string;
  thankYouMessage: string;
  footerMessage: string;
  legalDisclaimer: string;
  refundPolicy: string;
  customTextBlocks: { id: string; title: string; content: string; enabled: boolean }[];
}

export interface CurrencySettings {
  currencyCode?: string; // e.g. 'INR', 'USD', 'EUR', 'GBP', 'AED'
  code?: string; // alias e.g. 'INR', 'USD'
  currencyName?: string; // e.g. 'Indian Rupee', 'US Dollar'
  name?: string; // alias e.g. 'Indian Rupee'
  country?: string; // e.g. 'India', 'United States'
  symbol: string; // e.g. '₹', '$', '€', '£', 'د.إ'
  placement: 'before' | 'after'; // 'before' ($ 50,000.00) or 'after' (50,000.00 د.إ)
  decimalPlaces: number; // 0, 2, or 3
  thousandSeparator: string;
  decimalSeparator: string;
  showCode?: boolean; // default false
  numberingSystem?: 'indian' | 'international';
  grouping?: 'indian' | 'international'; // alias
  unitNameSingular?: string; // 'Rupee', 'Dollar', 'Euro', 'Pound'
  unitNamePlural?: string; // 'Rupees', 'Dollars', 'Euros', 'Pounds'
  subunitNameSingular?: string; // 'Paisa', 'Cent', 'Penny'
  subunitNamePlural?: string; // 'Paisa', 'Cents', 'Pence'
}

export interface CompanySettings {
  profileId: string;
  profileName: string;
  isDefault: boolean;
  legalName: string;
  displayName: string;
  tagline: string;
  gstin: string;
  pan: string;
  cin: string;
  addressLine1: string;
  addressLine2: string;
  branchAddress: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  supportEmail: string;

  brandPalette: BrandPalette;
  typography: TypographySettings;
  assets: AssetSettings;
  content: ContentSettings;
  currency: CurrencySettings;

  bankAccounts: BankAccount[];
  activeBankId: string;

  signatureHeading: string;
  authorizedPerson: string;
  designation: string;
}

export interface BankAccount {
  id: string;
  accountHolderName: string;
  bankAccountName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branch: string;
  upiId: string;
  isDefault: boolean;
}

export interface MappingProfile {
  id: string;
  name: string;
  description: string;
  worksheetName: string;
  mappings: Record<string, { column: string; fetchEnabled: boolean; pdfVisibility: boolean; displayName: string }>;
  calculationSettings?: CalculationSettings;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  orientation: 'portrait' | 'landscape';
  primaryColor: string;
  fontFamily: string;
  showSections: {
    companyHeader: boolean;
    invoiceDetails: boolean;
    billTo: boolean;
    subject: boolean;
    itemTable: boolean;
    taxSummary: boolean;
    amountInWords: boolean;
    paymentSummary: boolean;
    notes: boolean;
    bankDetails: boolean;
    signature: boolean;
    terms: boolean;
    footer: boolean;
  };
  labels: Record<string, string>;
  customCss?: string;
}

export interface GenerationRecord {
  id: string;
  invoiceNumber: string;
  customerName: string;
  sourceType: 'excel' | 'googlesheets' | 'mock';
  sourceName: string;
  worksheetName: string;
  generatedDate: string;
  totalAmount: number;
  gstAmount: number;
  templateId: string;
  profileId: string;
  revisionNumber: number;
  status: 'success' | 'warning' | 'error';
  dataSnapshot: any;
  previousVersions?: any[];
  paymentMethod?: string;
  paymentStatus?: string;
  paymentDate?: string;
  paymentReference?: string;
  paymentAmount?: number;
  paymentNotes?: string;
}

export interface InvoiceModel {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  customerName: string;
  customerBusiness?: string;
  customerAddress?: string;
  customerGstin?: string;
  customerEmail?: string;
  subject?: string;
  placeOfSupply?: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentDate: string;
  paymentReference: string;
  paymentAmount: number;
  paymentNotes: string;
  subtotal: number;
  totalInvoiceAmount: number;
  balanceDue: number;
  items: InvoiceItem[];
}

export interface SpreadsheetData {
  fileName: string;
  worksheets: { name: string; headers: string[]; rows: Record<string, any>[] }[];
  activeSheetName: string;
}

export type GuidedWorkflowStep = 
  | 'source' 
  | 'mapping' 
  | 'amount_calc' 
  | 'gst_calc' 
  | 'review' 
  | 'finalize';

export type CalculationMethod = 'excel_column' | 'automatic' | 'fixed' | 'manual' | 'formula';

export interface FieldCalculationConfig {
  method: CalculationMethod;
  sourceColumn?: string;
  fixedValue?: number;
  formula?: string; // e.g. "Quantity * Unit_Price"
}

export interface AdvancedAmountCalculationSettings {
  quantity: FieldCalculationConfig;
  unitRate: FieldCalculationConfig;
  grossAmount: FieldCalculationConfig;
  discount: FieldCalculationConfig;
  discountPercentage?: FieldCalculationConfig;
  taxableAmount: FieldCalculationConfig;
  additionalCharges: FieldCalculationConfig;
  lineTotal: FieldCalculationConfig;
  subtotal: FieldCalculationConfig;
}

export interface GstConfigurationSettings {
  enabled: boolean;
  pricingType: 'inclusive' | 'exclusive';
  rateSource: 'fixed' | 'column';
  fixedRate: number; // e.g. 18
  rateColumn?: string;
  taxType: 'AUTO' | 'CGST_SGST' | 'IGST';
}

export interface WorkflowSessionState {
  currentStep: GuidedWorkflowStep;
  completedSteps: GuidedWorkflowStep[];
  selectedWorksheetName: string;
  headerRowIndex: number;
  startRowIndex: number;
  endRowIndex?: number;
  amountSettings: AdvancedAmountCalculationSettings;
  gstSettings: GstConfigurationSettings;
  customEditedRows?: Record<number, Record<string, any>>;
  updatedAt: string;
}


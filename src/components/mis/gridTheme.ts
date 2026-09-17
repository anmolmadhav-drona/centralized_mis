// AG Grid themes — quartz-based, matched to the Drona Logitech design tokens
// Light: warm workspace (white / #FAFAF8 banded rows, beige header)
// Dark:  warm charcoal with gold accents
import { themeQuartz } from 'ag-grid-community'

const FONT = "'Manrope', 'Inter', 'Segoe UI', system-ui, sans-serif"

export const agLightTheme = themeQuartz.withParams({
  fontFamily: FONT,
  fontSize: 12.5,
  backgroundColor: '#ffffff',
  foregroundColor: '#252525',
  borderColor: '#E7E3DE',
  headerBackgroundColor: '#F4F0EA',
  headerTextColor: '#4A3F35',
  headerFontSize: 12,
  headerFontWeight: 600,
  oddRowBackgroundColor: '#FAF9F6',
  rowHoverColor: '#F6EFE3',
  selectedRowBackgroundColor: '#F9EBDD',
  accentColor: '#A91518',
  wrapperBorder: true,
  wrapperBorderRadius: 8,
  cellHorizontalPadding: 10,
  rowHeight: 36,
  headerHeight: 36,
})

export const agDarkTheme = themeQuartz.withParams({
  fontFamily: FONT,
  fontSize: 12.5,
  backgroundColor: '#26221F',
  foregroundColor: '#ECE9E4',
  borderColor: '#3B3631',
  headerBackgroundColor: '#302B27',
  headerTextColor: '#D8D2CB',
  headerFontSize: 12,
  headerFontWeight: 600,
  oddRowBackgroundColor: '#2A2622',
  rowHoverColor: '#35302A',
  selectedRowBackgroundColor: '#3E362A',
  accentColor: '#E89A16',
  wrapperBorder: true,
  wrapperBorderRadius: 8,
  cellHorizontalPadding: 10,
  rowHeight: 36,
  headerHeight: 36,
  // built from the light quartz base, so the dark color-scheme part must be
  // re-declared: otherwise AG Grid marks every control color-scheme:light and
  // native date-input picker icons / placeholders render black-on-dark
  browserColorScheme: 'dark',
  // dark-part defaults lost when overriding the light base:
  menuBackgroundColor: '#2A2723',
  popupShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
})

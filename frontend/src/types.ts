export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'compatible'
  baseUrl?: string
  apiKey?: string
  model: string
  timeout: number  // seconds
}

export type ParagraphAlign = 'left' | 'center' | 'right' | 'justify'

export interface Paragraph {
  index: number
  text: string
  style: string
}

export interface TextRun {
  text: string
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
  strike?: boolean | null
  font_name?: string | null
  size?: number | null       // points (= px in natural slide coordinate space)
  color?: string | null      // '#RRGGBB'
}

export interface SlideParagraph {
  text: string
  align?: ParagraphAlign
  runs: TextRun[]
}

export interface TableCell {
  text: string
  fill?: string | null       // '#RRGGBB'
}

export interface Shape {
  index: number
  name: string
  shape_type: 'text' | 'image' | 'table'
  text: string
  left: number               // EMU
  top: number                // EMU
  width: number              // EMU
  height: number             // EMU
  paragraphs: SlideParagraph[]
  fill_color?: string | null
  ph_idx?: number | null     // 0 = title, 1 = body/subtitle
  vertical_anchor?: string   // 'top' | 'middle' | 'bottom'
  image_src?: string | null  // image URL or data URL for image shapes
  table_data?: TableCell[][]  // rows × cols for table shapes
}

export interface Slide {
  index: number
  shapes: Shape[]
  background?: string | null
  background_image_src?: string | null
}

export interface DocxStructure {
  paragraphs: Paragraph[]
  total: number
  page_count?: number
}

export interface PptxStructure {
  slides: Slide[]
  total: number
  slide_width: number        // EMU
  slide_height: number       // EMU
}

export interface UploadResponse {
  file_id: string
  file_type: 'docx' | 'pptx'
  name: string
  html?: string
  structure: DocxStructure | PptxStructure
  can_undo: boolean
  can_redo: boolean
}

export interface Directory {
  id: string
  name: string
}

export interface Workspace {
  id: string
  name: string          // auto-set to filename on upload, editable by user
  doc: UploadResponse | null
  currentSlide: number
  selectedIndices: number[]
  selectedTable: number | null
  parentId?: string     // set when this workspace was branched from another
  directoryId?: string  // set when placed inside a directory
}

export interface RevisionScope {
  type: 'document' | 'paragraphs' | 'slide' | 'shape' | 'table_cell' | 'table' | 'insert_table'
  paragraph_indices?: number[]
  slide_index?: number
  shape_indices?: number[]
  table_index?: number
  row_index?: number
  cell_index?: number
  // insert_table fields
  paragraph_index?: number   // insert after this paragraph (-1 = end of document)
  rows?: number
  cols?: number
}

export interface Revision {
  scope: RevisionScope
  original: string
  revised: string
  font_name?: string | null
  font_size?: number | null
  align?: ParagraphAlign | null
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
  strike?: boolean | null
}

export interface ReviseResponse {
  revisions: Revision[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

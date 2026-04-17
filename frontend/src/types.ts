export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'compatible'
  baseUrl?: string
  apiKey?: string
  model: string
  timeout: number  // seconds
}

export interface LLMConnectionResult {
  ok: boolean
  provider: string
  model: string
  base_url?: string
  response_preview?: string
}

export type AppMode = 'ai' | 'manual' | 'compare'

export type LanguageCode = 'en' | 'zh' | 'ko'

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
  bullet?: boolean
  level?: number
}

export interface TableCell {
  text: string
  fill?: string | null       // '#RRGGBB'
}

export interface Shape {
  index: number
  name: string
  shape_type: 'text' | 'image' | 'table' | 'decoration'
  text: string
  left: number               // EMU
  top: number                // EMU
  width: number              // EMU
  height: number             // EMU
  paragraphs: SlideParagraph[]
  fill_color?: string | null
  fill_gradient?: string | null
  stroke_color?: string | null
  stroke_width?: number | null
  rotation?: number
  flip_horizontal?: boolean
  flip_vertical?: boolean
  preset_geometry?: string | null
  geometry_adjustments?: Record<string, number> | null
  svg_path?: string | null
  svg_viewbox_width?: number | null
  svg_viewbox_height?: number | null
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

export interface TextDocumentStructure {
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
  file_type: 'docx' | 'pptx' | 'markdown'
  name: string
  html?: string
  structure: TextDocumentStructure | PptxStructure
  can_undo: boolean
  can_redo: boolean
  slide_render_version?: string
  slide_renderer_available?: boolean
  slide_render_backend?: string | null
}

export type CompareSlotSource = 'workspace' | 'upload'

export interface CompareSlot {
  doc: UploadResponse
  source: CompareSlotSource
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
  type: 'document' | 'paragraphs' | 'merge_paragraphs' | 'slide' | 'shape' | 'table_cell' | 'table' | 'insert_table' | 'insert_paragraph' | 'delete_paragraph' | 'insert_slide' | 'delete_slide' | 'duplicate_slide' | 'insert_text_box' | 'move_shape'
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
  cells?: string[][]
  // insert_text_box fields
  text_box_left?: number     // EMU
  text_box_top?: number      // EMU
  text_box_width?: number    // EMU
  text_box_height?: number   // EMU
  // insert_slide with content fields
  slide_title?: string
  slide_body?: string
  // move_shape fields (EMU)
  new_left?: number
  new_top?: number
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
  bullet?: boolean | null
}

export interface ReviseResponse {
  revisions: Revision[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

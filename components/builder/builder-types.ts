import type {
  BackgroundSettings,
  BuilderPageRecord,
  BuilderTemplateLayout,
  BuilderTemplateKind,
  BuilderTemplateModuleType,
  BuilderTemplateRecord,
  BuilderTheme
} from "@/lib/builder-template";
import type { BuilderEmailFunction } from "@/lib/builder-email-template";
import type { BuilderModalAnchor } from "@/lib/builder-anchored-modal";
import { BUILDER_CAPABILITIES } from "@/lib/capabilities";

export type ModulePaletteGroup = BuilderTemplateModuleType | "special-effects" | "blog" | "admin";

export type GalleryTarget =
  | { kind: "module"; sectionId: string; moduleId: string }
  | { kind: "rich-text"; sectionId: string; moduleId: string }
  | { kind: "button-background"; sectionId: string; moduleId: string }
  | { kind: "section-background"; sectionId: string }
  | { kind: "social-icon"; sectionId: string; moduleId: string; itemId: string };

export type RichTextGalleryBinding = {
  onOpenGallery?: (anchor?: BuilderModalAnchor) => void;
  galleryImagePath?: string | null;
  onGalleryImageConsumed?: () => void;
  onUploadGalleryImage?: (file: File) => Promise<string | null>;
};

export type ModulePaletteItem = {
  id: string;
  type: BuilderTemplateModuleType;
  group: ModulePaletteGroup;
  label: string;
  icon: string;
  description: string;
  name: string;
  text: string;
  settings?: Record<string, string>;
};

export type BuilderDraft = {
  id: string;
  name: string;
  templateKind: BuilderTemplateKind;
  emailFunction: BuilderEmailFunction | "";
  pageBackground: BackgroundSettings;
  theme: BuilderTheme;
  layoutSections: import("@/lib/builder-template").BuilderTemplateSection[];
};

export const layoutOptions: Array<{ value: BuilderTemplateLayout; label: string }> = [
  { value: "single", label: "Single Column" },
  { value: "two-column", label: "Two Column" },
  { value: "three-column", label: "Three Column" },
  { value: "two-four", label: "2 / 4 Split" },
  { value: "four-two", label: "4 / 2 Split" },
  { value: "one-five", label: "1 / 5 Split" },
  { value: "five-one", label: "5 / 1 Split" }
];

export const modulePaletteGroups: Array<{
  value: ModulePaletteGroup;
  label: string;
  icon: string;
  description: string;
}> = [
  { value: "navigation", label: "Navigation", icon: "≡", description: "Menus, link bars, and top navigation." },
  { value: "heading", label: "Headings", icon: "H", description: "Titles, labels, and section headers." },
  { value: "headline-rotator", label: "Headline Rotator", icon: "↻", description: "Cycles through a list of headlines with a fade transition." },
  { value: "text", label: "Text", icon: "T", description: "Paragraphs, intros, and supporting copy." },
  { value: "code", label: "Code", icon: "</>", description: "Embed codes, widgets, and raw HTML snippets." },
  { value: "merch", label: "Merch", icon: "$", description: "Product cards from the shop catalog or custom URLs." },
  { value: "image", label: "Image", icon: "I", description: "Images, logos, and visual media." },
  { value: "floating-image", label: "Floating Image", icon: "✦", description: "Absolutely positioned images that float over the layout." },
  { value: "video", label: "Video", icon: "V", description: "Embeddable videos from YouTube, Vimeo, or uploaded files." },
  { value: "quote", label: "Quote", icon: "Q", description: "Pull quotes, testimonials, and callouts." },
  {
    value: "speech-bubble",
    label: "Speech Bubble",
    icon: "💬",
    description: "Speech callouts with a tail pointing toward a character."
  },
  {
    value: "reminder",
    label: "Reminders",
    icon: "🔔",
    description: "Criteria-based speech bubbles or strips for anonymous and registered visitors."
  },
  { value: "button", label: "Buttons", icon: "B", description: "Calls to action and navigation links." },
  { value: "contact-form", label: "Contact Forms", icon: "CF", description: "Lead capture forms with simple presets." },
  { value: "crm-form", label: "CRM", icon: "CRM", description: "CRM lead-capture forms linked to the project's contact table." },
  { value: "player-portal", label: "Player Portal", icon: "PP", description: "Player login and registration on any page." },
  { value: "previous-results", label: "Previous Results", icon: "PR", description: "Only the live previous-poll results panel." },
  { value: "current-poll", label: "Polls", icon: "P?", description: "The current live poll with vote actions." },
  {
    value: "poll-category-list",
    label: "Poll Categories",
    icon: "☰",
    description: "Linked list of poll categories that open the home page filtered by category."
  },
  { value: "social-share", label: "Social Share", icon: "↗", description: "Share buttons with dynamic post text from the current poll." },
  { value: "social", label: "Social", icon: "@", description: "Linked rows of social icons and profile badges." },
  { value: "table", label: "Tables", icon: "⊞", description: "Data tables with configurable columns and rows." },
  { value: "slider", label: "Sliders", icon: "⇆", description: "Horizontally scrollable bars of managed cards." },
  { value: "breadcrumb", label: "Breadcrumb", icon: "›", description: "Horizontal trail showing the visitor's location in the site hierarchy." },
  { value: "blog", label: "Blog", icon: "✍", description: "Blog content modules — post feeds, filters, author bios, and more." },
  {
    value: "special-effects",
    label: "Special Effects",
    icon: "🪄",
    description: "Confetti bursts and saved celebration effects for buttons, page load, and the game layer."
  },
  {
    value: "admin",
    label: "Admin",
    icon: "⚙",
    description: "Project admin tools — team users, premium modules, and management panels."
  }
];

export const modulePaletteItems: ModulePaletteItem[] = [
  {
    id: "navigation-site-menu",
    type: "navigation",
    group: "navigation",
    label: "Top Menu",
    icon: "≡",
    description: "The main site navigation menu used across the public pages.",
    name: "",
    text: "",
    settings: { variant: "site-nav" }
  },
  {
    id: "navigation-tractor-nav",
    type: "tractor-nav",
    group: "navigation",
    label: "TractorNav",
    icon: "⊙",
    description: "Proximity-aware overlay: concentric hover rings that pulse as the cursor approaches a center link.",
    name: "",
    text: "",
    settings: {
      color: "#0000ff",
      dotSize: "10",
      dotHoverColor: "#ffffff",
      ringCount: "10",
      sizingMode: "linear",
      ringStep: "10",
      outerSize: "600",
      curve: "2",
      innerOpacity: "90",
      opacityStep: "10",
      transition: "0",
      posX: "0",
      posY: "0",
      zIndex: "-9999"
    }
  },
  {
    id: "heading-eyebrow",
    type: "heading",
    group: "heading",
    label: "Eyebrow",
    icon: "Ey",
    description: "Small label above a larger message.",
    name: "",
    text: "",
    settings: {
      variant: "eyebrow",
      level: "h6",
      fontSize: "14",
      bold: "true",
      marginTop: "0",
      marginBottom: "0"
    }
  },
  {
    id: "heading-section",
    type: "heading",
    group: "heading",
    label: "Section Heading",
    icon: "H2",
    description: "Primary heading for a pod or section.",
    name: "",
    text: "",
    settings: { variant: "section", level: "h2", fontSize: "32", bold: "true" }
  },
  {
    id: "heading-hero",
    type: "heading",
    group: "heading",
    label: "Hero Title",
    icon: "H1",
    description: "Large, high-impact headline treatment.",
    name: "",
    text: "",
    settings: { variant: "hero", level: "h1", fontSize: "56", bold: "true" }
  },
  {
    id: "headline-rotator-default",
    type: "headline-rotator",
    group: "headline-rotator",
    label: "Headline Rotator",
    icon: "↻",
    description: "Cycles through headlines with a fade transition.",
    name: "",
    text: "",
    settings: {
      fontSize: "32",
      color: "#18324a",
      bold: "true",
      alignment: "center",
      verticalAlignment: "top",
      minHeight: "480",
      fadeDuration: "800",
      displaySpeed: "3000",
      headlines: JSON.stringify([])
    }
  },
  {
    id: "text-paragraph",
    type: "text",
    group: "text",
    label: "Paragraph",
    icon: "P",
    description: "Standard body copy block.",
    name: "",
    text: "",
    settings: { variant: "paragraph" }
  },
  {
    id: "text-intro",
    type: "text",
    group: "text",
    label: "Intro Copy",
    icon: "In",
    description: "Slightly larger intro or lead copy.",
    name: "",
    text: "",
    settings: { variant: "intro" }
  },
  {
    id: "text-caption",
    type: "text",
    group: "text",
    label: "Caption",
    icon: "Cp",
    description: "Smaller utility or supporting note.",
    name: "",
    text: "",
    settings: { variant: "caption" }
  },
  {
    id: "code-embed",
    type: "code",
    group: "code",
    label: "Code",
    icon: "</>",
    description: "Raw embed code or HTML snippet.",
    name: "",
    text: "",
    settings: { variant: "embed", label: "", snippetMode: "html" }
  },
  {
    id: "merch-product-card",
    type: "merch",
    group: "merch",
    label: "Merch",
    icon: "$",
    description: "Redbubble product card generated from a product URL.",
    name: "",
    text: "",
    settings: { variant: "product-card", productId: "", productUrl: "", productName: "", imageUrl: "", buttonLabel: "Buy on Redbubble" }
  },
  {
    id: "image-standard",
    type: "image",
    group: "image",
    label: "Image",
    icon: "Img",
    description: "Standard image block with caption support.",
    name: "",
    text: "",
    settings: { variant: "image", url: "", alt: "" }
  },
  {
    id: "image-logo",
    type: "image",
    group: "image",
    label: "Logo",
    icon: "Lg",
    description: "Compact brand or partner mark.",
    name: "",
    text: "",
    settings: { variant: "logo", url: "", alt: "" }
  },
  {
    id: "floating-image-decor",
    type: "floating-image",
    group: "floating-image",
    label: "Floating Image",
    icon: "✦",
    description: "Decorative image positioned over other content without affecting layout height.",
    name: "",
    text: "",
    settings: { variant: "decor", url: "", alt: "", size: "15", overlayAnchor: "center", zIndex: "20", effect: "bounce" }
  },
  {
    id: "image-video",
    type: "video",
    group: "video",
    label: "Video",
    icon: "Vid",
    description: "Embedded video with name and description.",
    name: "",
    text: "",
    settings: { variant: "embed", url: "", videoName: "", videoDescription: "" }
  },
  {
    id: "speech-bubble-default",
    type: "speech-bubble",
    group: "speech-bubble",
    label: "Speech Bubble",
    icon: "💬",
    description: "Rounded callout with a tail for character dialogue.",
    name: "",
    text: "<p>Hi! What's up?</p>",
    settings: {
      backgroundColor: "#ffffff",
      borderColor: "#9ed4ee",
      borderThickness: "2",
      textColor: "#18324a",
      borderRadius: "40",
      containerWidth: "520",
      containerHeight: "0",
      trigger: "game",
      gameAudience: "both",
      offsetX: "0",
      offsetY: "0",
      zIndex: "10"
    }
  },
  {
    id: "reminder-module",
    type: "reminder",
    group: "reminder",
    label: "Reminders",
    icon: "🔔",
    description: "Criteria-based overlays — add many reminders in one module.",
    name: "Reminders",
    text: "",
    settings: {
      reminderRecordsJson: JSON.stringify([
        {
          id: "signup-nudge",
          name: "Signup Nudge",
          messageHtml: "<p>Create a free account to save your picks and earn points.</p>",
          appearance: "speech_bubble",
          gameAudience: "both",
          isActive: true,
          sortOrder: 0,
          criteriaLogic: "and",
          criteria: [
            { id: "polls-taken", type: "polls_taken", value: { operator: "gte", count: 1 } },
            { id: "not-registered", type: "registered", value: { registered: false } }
          ],
          backgroundColor: "#ffffff",
          borderColor: "#4cbb17",
          borderThickness: "2",
          containerWidth: "520",
          offsetX: "0",
          offsetY: "0",
          zIndex: "46"
        }
      ])
    }
  },
  {
    id: "quote-pull",
    type: "quote",
    group: "quote",
    label: "Pull Quote",
    icon: "Qt",
    description: "Stylized editorial quotation.",
    name: "",
    text: "",
    settings: { variant: "pull" }
  },
  {
    id: "quote-testimonial",
    type: "quote",
    group: "quote",
    label: "Testimonial",
    icon: "Tm",
    description: "Customer or audience endorsement.",
    name: "",
    text: "",
    settings: { variant: "testimonial" }
  },
  {
    id: "quote-stat",
    type: "quote",
    group: "quote",
    label: "Stat Callout",
    icon: "St",
    description: "Short statistic or proof point.",
    name: "",
    text: "",
    settings: { variant: "stat" }
  },
  {
    id: "button-primary",
    type: "button",
    group: "button",
    label: "Primary CTA",
    icon: "Go",
    description: "Main call to action button.",
    name: "",
    text: "",
    settings: { variant: "primary", href: "", buttonColor: "#214c71", buttonHoverColor: "#0f4f8f", textColor: "#ffffff", textHoverColor: "#ffffff", borderColor: "#214c71", paddingX: "24", paddingY: "12" }
  },
  {
    id: "button-secondary",
    type: "button",
    group: "button",
    label: "Secondary CTA",
    icon: "Alt",
    description: "Lower emphasis alternate action.",
    name: "",
    text: "",
    settings: { variant: "secondary", href: "", buttonColor: "transparent", buttonHoverColor: "#eaf4ff", textColor: "#214c71", textHoverColor: "#0f4f8f", borderColor: "#214c71", paddingX: "24", paddingY: "12" }
  },
  {
    id: "button-anchor",
    type: "button",
    group: "button",
    label: "Anchor Link",
    icon: "Jump",
    description: "Jump to another section on the page.",
    name: "",
    text: "",
    settings: { variant: "anchor", href: "", buttonColor: "transparent", buttonHoverColor: "transparent", textColor: "#214c71", textHoverColor: "#0f4f8f", borderColor: "transparent", paddingX: "16", paddingY: "8" }
  },
  {
    id: "contact-form-default",
    type: "contact-form",
    group: "contact-form",
    label: "Contact Form",
    icon: "CF",
    description: "Squeeze, standard, or custom contact capture.",
    name: "",
    text: "",
    settings: { formMode: "squeeze" }
  },
  {
    id: "crm-form-default",
    type: "crm-form",
    group: "crm-form",
    label: "CRM Form",
    icon: "CRM",
    description: "Renders a CRM lead-capture form configured in Builder > CRM.",
    name: "",
    text: "",
    settings: { crmFormId: "" }
  },
  {
    id: "crm-contacts-table-default",
    type: "crm-contacts-table",
    group: "crm-form",
    label: "Contacts Table (Admin)",
    icon: "CRM",
    description: "Admin CRUD table showing all CRM contacts — view, edit, and delete rows. Place on a back-end admin page.",
    name: "Contacts",
    text: "",
    settings: {
      tableTitle: "Contacts",
      showTitle: "true",
      rowsPerPage: "20",
      showSearch: "true",
      showAddButton: "true",
      addButtonLabel: "Add Contact",
      showViewButton: "true",
      showEditButton: "true",
      showDeleteButton: "true"
    }
  },
  {
    id: "player-portal-login",
    type: "player-portal",
    group: "player-portal",
    label: "Player Login",
    icon: "PP",
    description: "Login and register for the Player Portal on any public page.",
    name: "Player Login",
    text: "",
    settings: {
      redirectPath: "/portal/dashboard",
      defaultMode: "login",
      showRegister: "true",
      showForgotPassword: "true"
    }
  },
  {
    id: "poll-previous-results",
    type: "previous-results",
    group: "previous-results",
    label: "Previous Results",
    icon: "PR",
    description: "Only the live previous-poll results panel.",
    name: "Previous Results",
    text: "",
    settings: {}
  },
  {
    id: "poll-current",
    type: "current-poll",
    group: "current-poll",
    label: "Current Poll",
    icon: "CP",
    description: "The live current poll with answer choices.",
    name: "Current Poll",
    text: "",
    settings: {}
  },
  {
    id: "poll-category-list-default",
    type: "poll-category-list",
    group: "poll-category-list",
    label: "Category List",
    icon: "☰",
    description: "All poll categories as links to the home page.",
    name: "Poll Categories",
    text: "",
    settings: {
      listTitle: "Categories",
      categorySort: "alphabetical",
      categoryListFlow: "rows",
      fontSize: "18",
      color: "#18324a",
      bold: "true",
      alignment: "left",
      itemGap: "8",
      backgroundMode: "color",
      backgroundColor: "#e8f6fc",
      backgroundColor2: "#eaf4ff",
      backgroundImageUrl: "",
      backgroundStyleKey: "",
      panelBorderColor: "#c6e8f5"
    }
  },
  {
    id: "poll-social-share",
    type: "social-share",
    group: "social-share",
    label: "Social Share",
    icon: "↗",
    description: "Share buttons that generate post text from the current poll.",
    name: "",
    text: "",
    settings: {
      shareLabel: "Share this poll",
      shareTemplate: 'I just answered: "{pollQuestion}" What would you pick? {url}',
      shareHashtags: "StarCaster,WYR",
      shareVia: "",
      shareLabelSize: "14",
      shareIconBackground: "#ffffff",
      shareIconSize: "36",
      shareGlyphSize: "20",
      shareIconGap: "12"
    }
  },
  {
    id: "social-icons-row",
    type: "social",
    group: "social",
    label: "Social Icons",
    icon: "@",
    description: "A ready-to-edit strip of social media icons with links.",
    name: "",
    text: "",
    settings: { variant: "icons-row" }
  },
  {
    id: "table-standard",
    type: "table",
    group: "table",
    label: "Data Table",
    icon: "⊞",
    description: "A configurable data table with headers.",
    name: "",
    text: "",
    settings: { variant: "standard" }
  },
  {
    id: "slider-standard",
    type: "slider",
    group: "slider",
    label: "Card Slider",
    icon: "⇆",
    description: "A horizontal scroller of cards that can hold linked visual highlights.",
    name: "",
    text: "",
    settings: { variant: "standard" }
  },
  {
    id: "breadcrumb-standard",
    type: "breadcrumb",
    group: "breadcrumb",
    label: "Breadcrumb",
    icon: "›",
    description: "A horizontal breadcrumb trail linking back through the page hierarchy.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "confetti-celebration",
    type: "confetti",
    group: "special-effects",
    label: "Confetti",
    icon: "🎉",
    description: "Celebration burst — button click, on load, or game-layer trigger.",
    name: "Confetti",
    text: "",
    settings: {
      particleCount: "100",
      spread: "70",
      originX: "0.5",
      originY: "0.6",
      zIndex: "12000",
      trigger: "button",
      buttonLabel: "Confetti",
      disableForReducedMotion: "false",
      sound: "pop",
      popVolume: "35"
    }
  },
  {
    id: "blog-post-create-standard",
    type: "blog-post-create",
    group: "blog",
    label: "Create Post (Admin)",
    icon: "✎",
    description: "Admin form that lets a logged-in project user create a new blog post. Place on a back-end admin page.",
    name: "",
    text: "",
    settings: { defaultStatus: "draft" }
  },
  {
    id: "blog-post-manager-standard",
    type: "blog-post-manager",
    group: "blog",
    label: "Post Manager (Admin)",
    icon: "⊞",
    description: "Admin CRUD table listing all blog posts with edit and delete actions. Place on a back-end admin page.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-card-manager-standard",
    type: "blog-card-manager",
    group: "blog",
    label: "Card Manager (Admin)",
    icon: "▭",
    description: "Visual designer for the blog post card template — element order, visibility, layout, and style. Saves project-wide. Place on a back-end admin page.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "messaging-topic-list-standard",
    type: "messaging-topic-list",
    group: "blog",
    label: "Topic List",
    icon: "◉",
    description: "Displays messaging topics as clickable pills, list, or dropdown that filter the blog post feed.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "messaging-tag-list-standard",
    type: "messaging-tag-list",
    group: "blog",
    label: "Tag List",
    icon: "#",
    description: "Displays messaging tags as a cloud, pills, or list that filter the blog post feed.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-category-manager-standard",
    type: "blog-category-manager",
    group: "blog",
    label: "Category Manager (Admin)",
    icon: "☰",
    description: "Admin CRUD panel for creating, editing, and deleting blog categories. Place on a back-end admin page.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-tag-cloud-standard",
    type: "blog-tag-cloud",
    group: "blog",
    label: "Tag Cloud",
    icon: "#",
    description: "Tag navigation widget — cloud, pills, or list — that filters posts by ?tag=slug.",
    name: "",
    text: "",
    settings: { layout: "cloud" }
  },
  {
    id: "blog-post-tags-standard",
    type: "blog-post-tags",
    group: "blog",
    label: "Post Tags",
    icon: "⊕",
    description: "Displays the tags attached to a blog post as styled pills at the bottom of the post.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-post-standard",
    type: "blog-post",
    group: "blog",
    label: "Blog Post",
    icon: "✍",
    description: "Full blog post editor: title, featured image, rich-text body, categories, tags, and SEO fields.",
    name: "",
    text: "",
    settings: { status: "draft" }
  },
  {
    id: "blog-category-filter-pills",
    type: "blog-category-filter",
    group: "blog",
    label: "Category Filter",
    icon: "⊙",
    description: "Pill, list, or dropdown filter that navigates to ?category=slug and pairs with a Post Feed.",
    name: "",
    text: "",
    settings: { layout: "pills" }
  },
  {
    id: "blog-related-posts-standard",
    type: "blog-related-posts",
    group: "blog",
    label: "Related Posts",
    icon: "↗",
    description: "A row of posts related to the current one by category, tag, or manual selection.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-newsletter-subscribe-standard",
    type: "blog-newsletter-subscribe",
    group: "blog",
    label: "Newsletter Subscribe",
    icon: "✉",
    description: "Email capture block backed by a CRM form — headline, description, and styled submit field.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-toc-standard",
    type: "blog-toc",
    group: "blog",
    label: "Table of Contents",
    icon: "≡",
    description: "A navigational list of headings that links readers to sections within the post.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "blog-author-bio-standard",
    type: "blog-author-bio",
    group: "blog",
    label: "Author Bio",
    icon: "👤",
    description: "Author photo, name, role, bio, and social links — typically placed at the end of a post.",
    name: "",
    text: "",
    settings: { layout: "horizontal" }
  },
  {
    id: "blog-post-card-standard",
    type: "blog-post-card",
    group: "blog",
    label: "Post Card",
    icon: "▭",
    description: "A manually configured single-post preview card — title, image, excerpt, and meta.",
    name: "",
    text: "",
    settings: { cardLayout: "vertical" }
  },
  {
    id: "blog-post-card-horizontal",
    type: "blog-post-card",
    group: "blog",
    label: "Post Card (Horizontal)",
    icon: "▬",
    description: "A side-by-side post card with image on the left and content on the right.",
    name: "",
    text: "",
    settings: { cardLayout: "horizontal" }
  },
  {
    id: "blog-post-list-grid",
    type: "blog-post-list",
    group: "blog",
    label: "Post Feed (Grid)",
    icon: "⊞",
    description: "A filterable grid of blog post cards with featured image, excerpt, and meta.",
    name: "",
    text: "",
    settings: { layout: "grid", columns: "3" }
  },
  {
    id: "blog-post-list-list",
    type: "blog-post-list",
    group: "blog",
    label: "Post Feed (List)",
    icon: "☰",
    description: "A filterable list of blog post summaries with image thumbnail and meta.",
    name: "",
    text: "",
    settings: { layout: "list", columns: "1" }
  },
  {
    id: "blog-search-standard",
    type: "blog-search",
    group: "blog",
    label: "Blog Search",
    icon: "⌕",
    description: "Search field that sends a query to the Blog Search Results module via a URL parameter.",
    name: "",
    text: "",
    settings: { placeholder: "Search posts…", buttonLabel: "Search", searchParam: "search" }
  },
  {
    id: "blog-search-results-standard",
    type: "blog-search-results",
    group: "blog",
    label: "Blog Search Results",
    icon: "▤",
    description: "Lists blog posts matching the current search query — thumbnail, title, excerpt, and last updated date.",
    name: "",
    text: "",
    settings: { searchParam: "search", limit: "50" }
  },
  {
    id: "admin-team-users-table",
    type: "admin-team-users",
    group: "admin",
    label: "Team Users",
    icon: "👥",
    description: "CRUD table of project admin team members — add, edit, and remove editors and admins.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "admin-modules-list",
    type: "admin-modules",
    group: "admin",
    label: "Premium Modules",
    icon: "⊞",
    description: "Lists the premium module groups enabled for this project and allows toggling them on or off.",
    name: "",
    text: "",
    settings: {}
  },
  {
    id: "admin-login-form",
    type: "admin-login",
    group: "admin",
    label: "Admin Login",
    icon: "🔐",
    description: "Login form for project admin team members. Validates credentials and redirects to /admin on success.",
    name: "",
    text: "",
    settings: {}
  }
];

// StarCaster: strip palette entries whose backing capability is disabled
// (the module code stays; see lib/builder-client/adapters/capabilities.ts).
if (!BUILDER_CAPABILITIES.playerPortal) {
  for (let i = modulePaletteGroups.length - 1; i >= 0; i -= 1) {
    if (modulePaletteGroups[i].value === "player-portal") modulePaletteGroups.splice(i, 1);
  }
  for (let i = modulePaletteItems.length - 1; i >= 0; i -= 1) {
    if (modulePaletteItems[i].group === "player-portal" || modulePaletteItems[i].type === "player-portal") {
      modulePaletteItems.splice(i, 1);
    }
  }
}

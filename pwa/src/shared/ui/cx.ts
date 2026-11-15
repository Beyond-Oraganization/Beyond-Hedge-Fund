/** Joins the class names that are set: `cx('k-btn', busy && 'busy')`. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

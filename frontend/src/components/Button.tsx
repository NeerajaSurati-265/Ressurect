import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type Variant = 'primary' | 'ghost' | 'spectral'

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition-[background-color,box-shadow,color,opacity,transform,background-position] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:translate-y-px active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 disabled:active:translate-y-0 disabled:active:scale-100'

/** Slow ember shimmer: a warm highlight band slides across the face on hover. */
const SHIMMER =
  'bg-[linear-gradient(100deg,transparent_30%,rgba(255,241,201,0.45)_50%,transparent_70%)] bg-[length:250%_100%] bg-[position:120%_0] hover:bg-[position:-20%_0] [transition-duration:200ms,200ms,200ms,200ms,200ms,1400ms]'

const VARIANTS: Record<Variant, string> = {
  primary: `bg-ember-500 ${SHIMMER} text-night-950 shadow-[0_0_24px_rgba(255,138,31,0.35)] hover:bg-ember-300 hover:shadow-[0_0_14px_rgba(255,179,92,0.55),0_0_44px_rgba(255,138,31,0.45)] active:shadow-[0_0_10px_rgba(255,138,31,0.35)]`,
  spectral: 'bg-spectral text-night-950 shadow-[0_0_28px_rgba(125,226,209,0.4)] hover:bg-[#a8efe3]',
  ghost: 'border border-moon/20 bg-night-950/50 text-moon hover:border-ember-300/60 hover:text-ember-300',
}

export const buttonClass = (variant: Variant = 'primary', extra = '') => `${BASE} ${VARIANTS[variant]} ${extra}`

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />
}

export function ButtonLink({ variant = 'ghost', className = '', ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...rest} />
}

export function ExternalButton({
  variant = 'primary',
  className = '',
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a target="_blank" rel="noopener noreferrer" className={buttonClass(variant, className)} {...rest} />
}

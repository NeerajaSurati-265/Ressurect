import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type Variant = 'primary' | 'ghost' | 'spectral'

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition-[background-color,box-shadow,color,opacity] disabled:cursor-wait disabled:opacity-70'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ember-500 text-night-950 shadow-[0_0_24px_rgba(255,138,31,0.35)] hover:bg-ember-300',
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

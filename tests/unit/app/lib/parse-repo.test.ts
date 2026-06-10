import { describe, it, expect } from 'vitest'
import { parseRepoInput } from '@/app/lib/parse-repo'

describe('parseRepoInput', () => {
  it('acepta el formato owner/repo', () => {
    expect(parseRepoInput('facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
    })
  })

  it('recorta espacios alrededor', () => {
    expect(parseRepoInput('  vercel/next.js  ')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    })
  })

  it('acepta una URL https de GitHub', () => {
    expect(parseRepoInput('https://github.com/facebook/react')).toEqual({
      owner: 'facebook',
      repo: 'react',
    })
  })

  it('acepta una URL sin esquema (github.com/...)', () => {
    expect(parseRepoInput('github.com/vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
    })
  })

  it('acepta www. y barra final', () => {
    expect(parseRepoInput('https://www.github.com/facebook/react/')).toEqual({
      owner: 'facebook',
      repo: 'react',
    })
  })

  it('ignora rutas extra (tree/main, etc.)', () => {
    expect(
      parseRepoInput('https://github.com/facebook/react/tree/main/packages'),
    ).toEqual({ owner: 'facebook', repo: 'react' })
  })

  it('quita el sufijo .git', () => {
    expect(parseRepoInput('https://github.com/facebook/react.git')).toEqual({
      owner: 'facebook',
      repo: 'react',
    })
  })

  it('ignora query y hash', () => {
    expect(parseRepoInput('github.com/a/b?tab=readme#top')).toEqual({
      owner: 'a',
      repo: 'b',
    })
  })

  it('devuelve null si falta el repo', () => {
    expect(parseRepoInput('facebook')).toBeNull()
    expect(parseRepoInput('https://github.com/facebook')).toBeNull()
  })

  it('devuelve null para entrada vacía', () => {
    expect(parseRepoInput('')).toBeNull()
    expect(parseRepoInput('   ')).toBeNull()
  })

  it('devuelve null si los segmentos tienen caracteres no válidos', () => {
    expect(parseRepoInput('owner /repo')).toBeNull()
    expect(parseRepoInput('own$er/repo')).toBeNull()
  })

  it('devuelve null si owner o repo superan 100 caracteres', () => {
    const long = 'a'.repeat(101)
    expect(parseRepoInput(`${long}/repo`)).toBeNull()
    expect(parseRepoInput(`owner/${long}`)).toBeNull()
  })
})

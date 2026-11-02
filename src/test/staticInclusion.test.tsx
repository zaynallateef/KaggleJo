import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AddProfileDialog } from '../components/AddProfileDialog'

vi.mock('../api', () => ({ IS_STATIC: true, HAS_SUPABASE: false, request: vi.fn() }))

it('explains automatic inclusion without collecting credentials or pretending to save a nomination', () => {
  render(<AddProfileDialog close={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Join the Jordan community' })).toBeInTheDocument()
  expect(screen.getByText('Make the location public.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open Kaggle' })).toHaveAttribute('href', 'https://www.kaggle.com/')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument()
})

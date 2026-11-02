import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AddProfileDialog } from '../components/AddProfileDialog'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ IS_STATIC: true, HAS_SUPABASE: true, request }))

it('lets a Pages visitor submit for review and never claims approval', async () => {
  request.mockResolvedValue({ message: 'Profile submitted for review. It will become searchable after its Jordan connection is approved.' })
  const user = userEvent.setup()
  render(<AddProfileDialog close={vi.fn()} />)
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Kaggle username'), 'loplop05')
  await user.selectOptions(within(dialog).getByLabelText('City in Jordan'), 'Not specified')
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
  expect(request).toHaveBeenCalledWith('/nominations', expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'loplop05', city: 'Not specified', evidence_url: 'https://www.kaggle.com/loplop05', confirmed: true }) }))
  expect(await within(dialog).findByText('Submitted for review.')).toBeInTheDocument()
  expect(within(dialog).queryByText('You’re on the list.')).not.toBeInTheDocument()
})

it('preserves submitted fields when the community service is unavailable', async () => {
  request.mockRejectedValue(new Error('The community service is unavailable.'))
  const user = userEvent.setup()
  render(<AddProfileDialog close={vi.fn()} />)
  await user.type(screen.getByLabelText('Kaggle username'), 'loplop05')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Submit for review' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.getByLabelText('Kaggle username')).toHaveValue('loplop05')
  expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
})

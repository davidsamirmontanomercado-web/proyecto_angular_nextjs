import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'El correo y la contraseña son obligatorios' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Supabase login error:', error);

      return NextResponse.json(
        { error: 'Correo o contraseña incorrectos' },
        { status: 401, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        message: 'Login exitoso',
        user: data.user,
        session: data.session,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error('Error en login:', error);

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    );
  }
}